import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test, { afterEach, beforeEach, describe } from 'node:test';
import assert from 'node:assert/strict';
import bcrypt from 'bcryptjs';
import AdmZip from 'adm-zip';
import request from 'supertest';
import { closeDb, getDb, initDb } from '../src/db.js';
import { createApp } from '../src/app.js';
import { validateFiles, ValidationError } from '../src/validation.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const seedDir = path.resolve(__dirname, '../seed/skills');
let tempDir;
let app;

beforeEach(() => {
  closeDb();
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'skill-control-test-'));
  initDb({
    dbPath: path.join(tempDir, 'test.db'),
    seedDir,
    bootstrapAdmin: { username: 'admin', password: 'AdminPass123', displayName: '测试管理员' },
  });
  getDb().prepare('UPDATE users SET must_change_password = 0').run();
  app = createApp();
});

afterEach(() => {
  closeDb();
  fs.rmSync(tempDir, { recursive: true, force: true });
});

function createUser(username, role, password = 'UserPass123') {
  const now = Date.now();
  const result = getDb().prepare(`
    INSERT INTO users(username, password_hash, display_name, role, status, must_change_password, created_at, updated_at)
    VALUES (?, ?, ?, ?, 'ACTIVE', 0, ?, ?)
  `).run(username, bcrypt.hashSync(password, 4), `${username}姓名`, role, now, now);
  return Number(result.lastInsertRowid);
}

async function login(username, password = 'UserPass123') {
  const agent = request.agent(app);
  const response = await agent.post('/api/auth/login').send({ username, password });
  assert.equal(response.status, 200, response.text);
  return agent;
}

async function createSubmittedVersion(editorAgent, suffix = '新增审核规则') {
  const skillResponse = await editorAgent.get('/api/skills/customer-prescreen');
  assert.equal(skillResponse.status, 200);
  const draftResponse = await editorAgent.post('/api/skills/customer-prescreen/drafts').send({});
  assert.equal(draftResponse.status, 201, draftResponse.text);
  const draftId = draftResponse.body.draftId;
  const draft = (await editorAgent.get(`/api/drafts/${draftId}`)).body.version;
  const files = draft.files.map((file) => file.path === 'SKILL.md' ? { path: file.path, content: `${file.content}\n\n## ${suffix}\n` } : { path: file.path, content: file.content });
  const saved = await editorAgent.patch(`/api/drafts/${draftId}`).send({ revision: draft.revision, files, summary: suffix });
  assert.equal(saved.status, 200, saved.text);
  const submitted = await editorAgent.post(`/api/drafts/${draftId}/submit`).send({ revision: saved.body.version.revision, summary: suffix });
  assert.equal(submitted.status, 200, submitted.text);
  return submitted.body.version;
}

describe('初始化与校验', () => {
  test('当前工作区的三个 Skill 和七个 Markdown 文件只导入一次', () => {
    const db = getDb();
    assert.equal(db.prepare('SELECT COUNT(*) AS count FROM skills').get().count, 3);
    assert.equal(db.prepare('SELECT COUNT(*) AS count FROM skill_versions').get().count, 3);
    assert.equal(db.prepare('SELECT COUNT(*) AS count FROM version_files').get().count, 7);
    assert.deepEqual(db.prepare('SELECT DISTINCT version_no FROM skill_versions').all(), [{ version_no: 1 }]);
    const current = db.prepare("SELECT content FROM version_files WHERE path = 'SKILL.md' AND content LIKE '%customer-prescreen%' LIMIT 1").get();
    assert.match(current.content, /通用双轨制链式推理引擎/);
  });

  test('阻止路径穿越、缺失 SKILL.md 和不匹配的 frontmatter', () => {
    assert.throws(() => validateFiles([{ path: '../secret.md', content: 'x' }], 'safe-skill', { strict: true }), ValidationError);
    assert.throws(() => validateFiles([{ path: 'SKILL.md', content: '---\nname: wrong\ndescription: x\n---\n' }], 'safe-skill', { strict: true }), /校验失败/);
    assert.doesNotThrow(() => validateFiles([{ path: 'SKILL.md', content: '---\nname: safe-skill\ndescription: 合法描述\ntool-calls: read queryData\n---\n' }], 'safe-skill', { strict: true }));
  });
});

describe('认证与权限', () => {
  test('未登录和错误角色不能访问写接口', async () => {
    const anonymous = await request(app).get('/api/skills');
    assert.equal(anonymous.status, 401);
    createUser('reviewer', 'REVIEWER');
    const reviewer = await login('reviewer');
    const denied = await reviewer.post('/api/skills').send({ slug: 'not-allowed' });
    assert.equal(denied.status, 403);
  });

  test('管理员创建账号后临时密码用户必须先改密', async () => {
    const admin = await login('admin', 'AdminPass123');
    const created = await admin.post('/api/admin/users').send({
      username: 'business', displayName: '业务人员', role: 'EDITOR', temporaryPassword: 'TempPass123',
    });
    assert.equal(created.status, 201, created.text);
    const business = await request.agent(app).post('/api/auth/login').send({ username: 'business', password: 'TempPass123' });
    assert.equal(business.status, 200);
    assert.equal(business.body.user.mustChangePassword, true);
  });
});

describe('版本审批工作流', () => {
  test('编辑提交、审核批准、快照不可变并可导出发布包', async () => {
    createUser('editor', 'EDITOR');
    createUser('reviewer', 'REVIEWER');
    const editor = await login('editor');
    const reviewer = await login('reviewer');
    const submitted = await createSubmittedVersion(editor);
    assert.equal(submitted.versionNo, 2);
    assert.equal(submitted.status, 'SUBMITTED');

    const immutable = await editor.patch(`/api/drafts/${submitted.id}`).send({ revision: submitted.revision, files: [] });
    assert.equal(immutable.status, 409);

    const approved = await reviewer.post(`/api/versions/${submitted.id}/review`).send({ decision: 'APPROVE', comment: '规则清晰，可以发布' });
    assert.equal(approved.status, 200, approved.text);
    assert.equal(approved.body.version.status, 'APPROVED');
    assert.equal(getDb().prepare("SELECT current_published_version_id AS id FROM skills WHERE slug = 'customer-prescreen'").get().id, submitted.id);

    const exported = await reviewer.get('/api/exports/current.zip').buffer(true).parse((res, callback) => {
      const chunks = [];
      res.on('data', (chunk) => chunks.push(chunk));
      res.on('end', () => callback(null, Buffer.concat(chunks)));
    });
    assert.equal(exported.status, 200);
    const zip = new AdmZip(exported.body);
    const entries = zip.getEntries().map((entry) => entry.entryName);
    assert.ok(entries.includes('skills/customer-prescreen/SKILL.md'));
    assert.ok(entries.includes('skills/financial-statement-analysis/references/framework.md'));
    const manifest = JSON.parse(zip.readAsText('manifest.json'));
    assert.equal(manifest.skills.find((skill) => skill.slug === 'customer-prescreen').version, 2);
    assert.equal(manifest.skills.length, 3);
  });

  test('驳回必须有原因，驳回版本不能原地修改', async () => {
    createUser('editor', 'EDITOR');
    createUser('reviewer', 'REVIEWER');
    const editor = await login('editor');
    const reviewer = await login('reviewer');
    const submitted = await createSubmittedVersion(editor, '需要补充的规则');
    const missingComment = await reviewer.post(`/api/versions/${submitted.id}/review`).send({ decision: 'REJECT', comment: '' });
    assert.equal(missingComment.status, 400);
    const rejected = await reviewer.post(`/api/versions/${submitted.id}/review`).send({ decision: 'REJECT', comment: '请补充规则的数据来源' });
    assert.equal(rejected.status, 200);
    assert.equal(rejected.body.version.status, 'REJECTED');
    const editAgain = await editor.patch(`/api/drafts/${submitted.id}`).send({ revision: submitted.revision, files: [] });
    assert.equal(editAgain.status, 409);
  });

  test('同一基线的并行提交在一个批准后自动使其他提交过期', async () => {
    createUser('editor1', 'EDITOR');
    createUser('editor2', 'EDITOR');
    createUser('reviewer', 'REVIEWER');
    const editor1 = await login('editor1');
    const editor2 = await login('editor2');
    const reviewer = await login('reviewer');
    const first = await createSubmittedVersion(editor1, '第一组并行修改');
    const second = await createSubmittedVersion(editor2, '第二组并行修改');
    assert.equal(first.basePublishedVersionId, second.basePublishedVersionId);
    assert.equal((await reviewer.post(`/api/versions/${first.id}/review`).send({ decision: 'APPROVE' })).status, 200);
    const secondState = await reviewer.get(`/api/versions/${second.id}`);
    assert.equal(secondState.body.version.status, 'SUPERSEDED');
  });

  test('即使角色后来变更，提交人仍不能审批自己的版本', async () => {
    const userId = createUser('switcher', 'EDITOR');
    const editor = await login('switcher');
    const submitted = await createSubmittedVersion(editor, '自审隔离测试');
    getDb().prepare("UPDATE users SET role = 'REVIEWER' WHERE id = ?").run(userId);
    const attempted = await editor.post(`/api/versions/${submitted.id}/review`).send({ decision: 'APPROVE' });
    assert.equal(attempted.status, 403);
    assert.match(attempted.body.error, /不能审核自己/);
  });

  test('回滚会创建新版本并再次经过审批，不覆盖历史版本', async () => {
    createUser('rollbackeditor', 'EDITOR');
    createUser('rollbackreviewer', 'REVIEWER');
    const editor = await login('rollbackeditor');
    const reviewer = await login('rollbackreviewer');
    const changed = await createSubmittedVersion(editor, '生成第二版');
    assert.equal((await reviewer.post(`/api/versions/${changed.id}/review`).send({ decision: 'APPROVE' })).status, 200);

    const detail = await editor.get('/api/skills/customer-prescreen');
    const originalV1 = detail.body.versions.find((version) => version.versionNo === 1);
    const rollbackDraft = await editor.post('/api/skills/customer-prescreen/drafts').send({ sourceVersionId: originalV1.id, rollback: true });
    assert.equal(rollbackDraft.status, 201, rollbackDraft.text);
    const draft = (await editor.get(`/api/drafts/${rollbackDraft.body.draftId}`)).body.version;
    assert.equal(draft.changeType, 'ROLLBACK');
    const submitted = await editor.post(`/api/drafts/${draft.id}/submit`).send({ revision: draft.revision, summary: '回滚到初始业务规则' });
    assert.equal(submitted.status, 200, submitted.text);
    assert.equal(submitted.body.version.versionNo, 3);
    assert.equal(getDb().prepare("SELECT current_published_version_id AS id FROM skills WHERE slug = 'customer-prescreen'").get().id, changed.id);

    const approved = await reviewer.post(`/api/versions/${draft.id}/review`).send({ decision: 'APPROVE', comment: '确认回滚' });
    assert.equal(approved.status, 200, approved.text);
    assert.equal(getDb().prepare("SELECT current_published_version_id AS id FROM skills WHERE slug = 'customer-prescreen'").get().id, draft.id);
    assert.equal(getDb().prepare("SELECT COUNT(*) AS count FROM skill_versions WHERE skill_id = ? AND status = 'APPROVED'").get(draft.skillId).count, 3);
  });
});
