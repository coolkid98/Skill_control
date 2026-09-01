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
import { validateFiles, validateReleaseTime, ValidationError } from '../src/validation.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const seedDir = path.resolve(__dirname, '../seed/skills');
let tempDir;
let dbPath;
let app;

beforeEach(() => {
  closeDb();
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'skill-control-test-'));
  dbPath = path.join(tempDir, 'test.db');
  initDb({
    dbPath,
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

async function createSubmittedVersion(editorAgent, suffix = '新增审核规则', releaseTime = '2026-09-18', slug = 'customer-prescreen') {
  const skillResponse = await editorAgent.get(`/api/skills/${slug}`);
  assert.equal(skillResponse.status, 200);
  const draftResponse = await editorAgent.post(`/api/skills/${slug}/drafts`).send({});
  assert.equal(draftResponse.status, 201, draftResponse.text);
  const draftId = draftResponse.body.draftId;
  const draft = (await editorAgent.get(`/api/drafts/${draftId}`)).body.version;
  const files = draft.files.map((file) => file.path === 'SKILL.md' ? { path: file.path, content: `${file.content}\n\n## ${suffix}\n` } : { path: file.path, content: file.content });
  const saved = await editorAgent.patch(`/api/drafts/${draftId}`).send({ revision: draft.revision, files, summary: suffix, releaseTime });
  assert.equal(saved.status, 200, saved.text);
  const submitted = await editorAgent.post(`/api/drafts/${draftId}/submit`).send({ revision: saved.body.version.revision, summary: suffix, releaseTime });
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
    assert.deepEqual(db.prepare('SELECT DISTINCT summary FROM skill_versions').all(), [{ summary: '初始版本' }]);
    const current = db.prepare("SELECT content FROM version_files WHERE path = 'SKILL.md' AND content LIKE '%customer-prescreen%' LIMIT 1").get();
    assert.match(current.content, /通用双轨制链式推理引擎/);
  });

  test('旧数据库启动时自动把初始版本说明迁移为简短文案', () => {
    getDb().prepare("UPDATE skill_versions SET summary = '从 credit_model 当前工作区导入的初始版本' WHERE version_no = 1").run();
    getDb().prepare('DELETE FROM schema_migrations WHERE version = 2').run();
    closeDb();
    initDb({
      dbPath,
      seedDir,
      bootstrapAdmin: { username: 'admin', password: 'AdminPass123', displayName: '测试管理员' },
    });
    assert.deepEqual(getDb().prepare('SELECT DISTINCT summary FROM skill_versions').all(), [{ summary: '初始版本' }]);
    assert.equal(getDb().prepare('SELECT COUNT(*) AS count FROM schema_migrations WHERE version = 2').get().count, 1);
  });

  test('旧数据库中的已批准版本自动按原审批日期补齐投产日期', () => {
    getDb().exec('DROP INDEX IF EXISTS idx_versions_release_time');
    getDb().exec('ALTER TABLE skill_versions DROP COLUMN release_time');
    getDb().prepare('DELETE FROM schema_migrations WHERE version = 3').run();
    closeDb();
    initDb({
      dbPath,
      seedDir,
      bootstrapAdmin: { username: 'admin', password: 'AdminPass123', displayName: '测试管理员' },
    });
    const approved = getDb().prepare("SELECT release_time FROM skill_versions WHERE status = 'APPROVED'").all();
    assert.equal(approved.length, 3);
    assert.ok(approved.every((version) => /^\d{4}-\d{2}-\d{2}$/.test(version.release_time)));
    assert.equal(getDb().prepare('SELECT COUNT(*) AS count FROM schema_migrations WHERE version = 3').get().count, 1);
  });

  test('阻止路径穿越、缺失 SKILL.md 和不匹配的 frontmatter', () => {
    assert.throws(() => validateFiles([{ path: '../secret.md', content: 'x' }], 'safe-skill', { strict: true }), ValidationError);
    assert.throws(() => validateFiles([{ path: 'SKILL.md', content: '---\nname: wrong\ndescription: x\n---\n' }], 'safe-skill', { strict: true }), /校验失败/);
    assert.doesNotThrow(() => validateFiles([{ path: 'SKILL.md', content: '---\nname: safe-skill\ndescription: 合法描述\ntool-calls: read queryData\n---\n' }], 'safe-skill', { strict: true }));
  });

  test('投产日期只接受有效的星期五', () => {
    assert.equal(validateReleaseTime('2026-08-28'), '2026-08-28');
    assert.equal(validateReleaseTime('2026-09-04'), '2026-09-04');
    assert.throws(() => validateReleaseTime('2026-08-29'), /星期五/);
    assert.throws(() => validateReleaseTime('2026-02-30'), /有效日期/);
    assert.equal(validateReleaseTime('2026-08-25', { fridayOnly: false }), '2026-08-25');
  });

  test('旧数据库启动时自动创建密码重置申请表', () => {
    getDb().exec('DROP TABLE password_reset_requests');
    getDb().prepare('DELETE FROM schema_migrations WHERE version = 4').run();
    closeDb();
    initDb({
      dbPath,
      seedDir,
      bootstrapAdmin: { username: 'admin', password: 'AdminPass123', displayName: '测试管理员' },
    });
    assert.ok(getDb().prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'password_reset_requests'").get());
    assert.equal(getDb().prepare('SELECT COUNT(*) AS count FROM schema_migrations WHERE version = 4').get().count, 1);
  });

  test('旧数据库启动时自动创建投产日期变更申请表', () => {
    getDb().exec('DROP TABLE release_time_change_requests');
    getDb().prepare('DELETE FROM schema_migrations WHERE version = 5').run();
    closeDb();
    initDb({
      dbPath,
      seedDir,
      bootstrapAdmin: { username: 'admin', password: 'AdminPass123', displayName: '测试管理员' },
    });
    assert.ok(getDb().prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'release_time_change_requests'").get());
    assert.equal(getDb().prepare('SELECT COUNT(*) AS count FROM schema_migrations WHERE version = 5').get().count, 1);
  });

  test('旧数据库启动时自动创建 Tool 清单表', () => {
    getDb().exec('DROP TABLE tool_documents');
    getDb().prepare('DELETE FROM schema_migrations WHERE version = 6').run();
    closeDb();
    initDb({
      dbPath,
      seedDir,
      bootstrapAdmin: { username: 'admin', password: 'AdminPass123', displayName: '测试管理员' },
    });
    assert.ok(getDb().prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'tool_documents'").get());
    assert.equal(getDb().prepare('SELECT COUNT(*) AS count FROM schema_migrations WHERE version = 6').get().count, 1);
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

  test('用户完成首次改密后仍可再次自助修改密码', async () => {
    createUser('repeat-password', 'EDITOR');
    const firstSession = await login('repeat-password');
    const firstChange = await firstSession.post('/api/auth/change-password').send({
      currentPassword: 'UserPass123', newPassword: 'SecondPass123',
    });
    assert.equal(firstChange.status, 200, firstChange.text);

    const secondSession = await login('repeat-password', 'SecondPass123');
    const secondChange = await secondSession.post('/api/auth/change-password').send({
      currentPassword: 'SecondPass123', newPassword: 'ThirdPass123',
    });
    assert.equal(secondChange.status, 200, secondChange.text);
    const thirdSession = await login('repeat-password', 'ThirdPass123');
    assert.equal((await thirdSession.get('/api/auth/me')).status, 200);
  });

  test('忘记密码申请不暴露账号状态，管理员重置后申请自动完成', async () => {
    const userId = createUser('forgot-user', 'EDITOR');
    const existing = await request(app).post('/api/auth/forgot-password').send({ username: 'forgot-user' });
    const missing = await request(app).post('/api/auth/forgot-password').send({ username: 'does-not-exist' });
    assert.equal(existing.status, 202);
    assert.equal(missing.status, 202);
    assert.equal(existing.body.message, missing.body.message);
    await request(app).post('/api/auth/forgot-password').send({ username: 'forgot-user' });
    assert.equal(getDb().prepare("SELECT COUNT(*) AS count FROM password_reset_requests WHERE user_id = ? AND status = 'PENDING'").get(userId).count, 1);

    const admin = await login('admin', 'AdminPass123');
    const pending = await admin.get('/api/admin/password-reset-requests');
    assert.equal(pending.status, 200, pending.text);
    assert.equal(pending.body.requests.length, 1);
    assert.equal(pending.body.requests[0].username, 'forgot-user');

    const reset = await admin.post(`/api/admin/users/${userId}/reset-password`).send({ temporaryPassword: 'ResetPass123' });
    assert.equal(reset.status, 204, reset.text);
    assert.equal(getDb().prepare("SELECT COUNT(*) AS count FROM password_reset_requests WHERE user_id = ? AND status = 'PENDING'").get(userId).count, 0);
    const relogin = await request.agent(app).post('/api/auth/login').send({ username: 'forgot-user', password: 'ResetPass123' });
    assert.equal(relogin.status, 200);
    assert.equal(relogin.body.user.mustChangePassword, true);
  });

  test('所有登录用户可查看 Tool 清单且只有用户名为 Chent 的用户可上传', async () => {
    createUser('Chent', 'REVIEWER');
    createUser('tool-viewer', 'EDITOR');
    const chent = await login('Chent');
    const viewer = await login('tool-viewer');
    const admin = await login('admin', 'AdminPass123');

    assert.equal((await request(app).get('/api/tool-catalog')).status, 401);
    const empty = await viewer.get('/api/tool-catalog');
    assert.equal(empty.status, 200, empty.text);
    assert.equal(empty.body.document, null);
    assert.equal(empty.body.canUpload, false);

    const denied = await admin.put('/api/tool-catalog').send({ filename: 'tools.md', content: '# Tools' });
    assert.equal(denied.status, 403);
    const badFile = await chent.put('/api/tool-catalog').send({ filename: '../tools.md', content: '# Tools' });
    assert.equal(badFile.status, 400);
    const wrongExtension = await chent.put('/api/tool-catalog').send({ filename: 'tools.txt', content: '# Tools' });
    assert.equal(wrongExtension.status, 400);
    const tooLarge = await chent.put('/api/tool-catalog').send({ filename: 'tools.md', content: 'x'.repeat(1024 * 1024 + 1) });
    assert.equal(tooLarge.status, 413);

    const uploaded = await chent.put('/api/tool-catalog').send({
      filename: 'tool-list.md',
      content: '# Tool 清单\n\n| 名称 | 用途 |\n| --- | --- |\n| search | 查询 |',
    });
    assert.equal(uploaded.status, 200, uploaded.text);
    assert.equal(uploaded.body.canUpload, true);
    assert.equal(uploaded.body.document.filename, 'tool-list.md');
    assert.match(uploaded.body.document.content, /Tool 清单/);

    const visible = await viewer.get('/api/tool-catalog');
    assert.equal(visible.status, 200, visible.text);
    assert.equal(visible.body.document.filename, 'tool-list.md');
    assert.equal(visible.body.canUpload, false);

    const replaced = await chent.put('/api/tool-catalog').send({ filename: 'tools-v2.MD', content: '# 第二版' });
    assert.equal(replaced.status, 200, replaced.text);
    assert.equal(getDb().prepare('SELECT COUNT(*) AS count FROM tool_documents').get().count, 1);
    assert.equal(getDb().prepare('SELECT filename FROM tool_documents WHERE id = 1').get().filename, 'tools-v2.MD');
    assert.equal(getDb().prepare("SELECT COUNT(*) AS count FROM audit_logs WHERE action = 'UPLOAD_TOOL_CATALOG'").get().count, 2);
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
    assert.equal(submitted.releaseTime, '2026-09-18');

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
    assert.equal(manifest.skills.find((skill) => skill.slug === 'customer-prescreen').releaseTime, '2026-09-18');
    assert.equal(manifest.skills.length, 3);
  });

  test('Skill 管理和工作台只返回最近三个投产窗口', async () => {
    createUser('window-editor', 'EDITOR');
    createUser('window-reviewer', 'REVIEWER');
    const editor = await login('window-editor');
    const reviewer = await login('window-reviewer');
    const releaseTimes = ['2026-09-04', '2026-09-11', '2026-09-18'];
    for (const [index, releaseTime] of releaseTimes.entries()) {
      const submitted = await createSubmittedVersion(editor, `窗口 ${index + 1} 变更`, releaseTime);
      const approved = await reviewer.post(`/api/versions/${submitted.id}/review`).send({ decision: 'APPROVE', comment: '窗口测试' });
      assert.equal(approved.status, 200, approved.text);
    }

    const skills = await editor.get('/api/skills');
    assert.equal(skills.status, 200, skills.text);
    const skill = skills.body.skills.find((item) => item.slug === 'customer-prescreen');
    assert.deepEqual(skill.recentReleaseVersions.map((version) => version.releaseTime), ['2026-09-18', '2026-09-11', '2026-09-04']);
    assert.equal(skill.recentReleaseVersions.length, 3);

    const dashboard = await editor.get('/api/dashboard');
    assert.equal(dashboard.status, 200, dashboard.text);
    assert.deepEqual(dashboard.body.recentGroups.map((group) => group.releaseTime), ['2026-09-18', '2026-09-11', '2026-09-04']);
    assert.equal(dashboard.body.recentGroups.length, 3);
  });

  test('投产日期提交时必填，批准后按日期分组并可独立导出', async () => {
    createUser('releaseeditor', 'EDITOR');
    createUser('releasereviewer', 'REVIEWER');
    const editor = await login('releaseeditor');
    const reviewer = await login('releasereviewer');

    const draftResponse = await editor.post('/api/skills/customer-prescreen/drafts').send({});
    assert.equal(draftResponse.status, 201, draftResponse.text);
    const draft = (await editor.get(`/api/drafts/${draftResponse.body.draftId}`)).body.version;
    const missingDate = await editor.post(`/api/drafts/${draft.id}/submit`).send({ revision: draft.revision, summary: '缺少投产日期' });
    assert.equal(missingDate.status, 400);
    assert.match(missingDate.body.error, /投产日期/);
    await editor.delete(`/api/drafts/${draft.id}`);

    const submitted = await createSubmittedVersion(editor, '九月投产批次', '2026-09-25');
    // 模拟升级前已提交、尚无投产日期的存量待审版本，由审核者在批准时补齐。
    getDb().prepare('UPDATE skill_versions SET release_time = NULL WHERE id = ?').run(submitted.id);
    const approved = await reviewer.post(`/api/versions/${submitted.id}/review`).send({ decision: 'APPROVE', comment: '纳入九月批次', releaseTime: '2026-09-25' });
    assert.equal(approved.status, 200, approved.text);
    const sameWindow = await createSubmittedVersion(editor, '同日金融分析变更', '2026-09-25', 'financial-statement-analysis');
    const sameWindowApproved = await reviewer.post(`/api/versions/${sameWindow.id}/review`).send({ decision: 'APPROVE', comment: '同日纳入批次' });
    assert.equal(sameWindowApproved.status, 200, sameWindowApproved.text);

    const releases = await reviewer.get('/api/releases');
    assert.equal(releases.status, 200, releases.text);
    const group = releases.body.groups.find((item) => item.releaseTime === '2026-09-25');
    assert.ok(group);
    assert.equal(group.versions.some((version) => version.id === submitted.id), true);
    assert.deepEqual(group.skills.map((skill) => skill.slug), ['customer-prescreen', 'financial-statement-analysis']);
    assert.equal(group.skills.find((skill) => skill.slug === 'financial-statement-analysis').versions[0].id, sameWindow.id);

    const exported = await reviewer.get('/api/exports/releases/2026-09-25.zip').buffer(true).parse((res, callback) => {
      const chunks = [];
      res.on('data', (chunk) => chunks.push(chunk));
      res.on('end', () => callback(null, Buffer.concat(chunks)));
    });
    assert.equal(exported.status, 200, exported.text);
    const manifest = JSON.parse(new AdmZip(exported.body).readAsText('manifest.json'));
    assert.equal(manifest.releaseTime, '2026-09-25');
    assert.deepEqual(manifest.skills.map((skill) => skill.slug), ['customer-prescreen', 'financial-statement-analysis']);
  });

  test('管理员可调整任意已批准版本的投产日期并记录审计', async () => {
    createUser('not-admin', 'EDITOR');
    const editor = await login('not-admin');
    const admin = await login('admin', 'AdminPass123');
    const version = getDb().prepare("SELECT id FROM skill_versions WHERE status = 'APPROVED' ORDER BY created_at LIMIT 1").get();

    const denied = await editor.patch(`/api/admin/versions/${version.id}/release-time`).send({ releaseTime: '2026-08-28' });
    assert.equal(denied.status, 403);
    const wrongDay = await admin.patch(`/api/admin/versions/${version.id}/release-time`).send({ releaseTime: '2026-08-29' });
    assert.equal(wrongDay.status, 400);
    assert.match(wrongDay.body.error, /星期五/);

    const updated = await admin.patch(`/api/admin/versions/${version.id}/release-time`).send({ releaseTime: '2026-08-28' });
    assert.equal(updated.status, 200, updated.text);
    assert.equal(updated.body.version.releaseTime, '2026-08-28');
    assert.equal(getDb().prepare('SELECT release_time FROM skill_versions WHERE id = ?').get(version.id).release_time, '2026-08-28');
    const audit = getDb().prepare("SELECT metadata FROM audit_logs WHERE action = 'UPDATE_RELEASE_TIME' AND target_id = ?").get(version.id);
    assert.equal(JSON.parse(audit.metadata).releaseTime, '2026-08-28');

    const legacyGroup = getDb().prepare("SELECT release_time, COUNT(*) AS count FROM skill_versions WHERE status = 'APPROVED' AND id != ? GROUP BY release_time ORDER BY count DESC LIMIT 1").get(version.id);
    const batch = await admin.patch(`/api/admin/releases/${legacyGroup.release_time}`).send({ releaseTime: '2026-09-04' });
    assert.equal(batch.status, 200, batch.text);
    assert.equal(batch.body.updatedCount, legacyGroup.count);
    assert.equal(getDb().prepare("SELECT COUNT(*) AS count FROM skill_versions WHERE status = 'APPROVED' AND release_time = '2026-09-04'").get().count, legacyGroup.count);
    assert.ok(getDb().prepare("SELECT id FROM audit_logs WHERE action = 'UPDATE_RELEASE_BATCH' AND target_id = ?").get(legacyGroup.release_time));
  });

  test('非管理员申请改期后，只有管理员批准才真正变更日期', async () => {
    createUser('date-applicant', 'EDITOR');
    createUser('second-applicant', 'REVIEWER');
    const applicant = await login('date-applicant');
    const secondApplicant = await login('second-applicant');
    const admin = await login('admin', 'AdminPass123');
    const version = getDb().prepare("SELECT id, release_time FROM skill_versions WHERE status = 'APPROVED' ORDER BY created_at LIMIT 1").get();

    const created = await applicant.post(`/api/versions/${version.id}/release-time-change-requests`).send({
      releaseTime: '2026-09-11', reason: '配合企业九月统一投产窗口',
    });
    assert.equal(created.status, 201, created.text);
    assert.equal(created.body.request.status, 'PENDING');
    assert.equal(getDb().prepare('SELECT release_time FROM skill_versions WHERE id = ?').get(version.id).release_time, version.release_time);

    const duplicate = await secondApplicant.post(`/api/versions/${version.id}/release-time-change-requests`).send({
      releaseTime: '2026-09-18', reason: '另一项改期申请',
    });
    assert.equal(duplicate.status, 409);
    const adminCannotApply = await admin.post(`/api/versions/${version.id}/release-time-change-requests`).send({
      releaseTime: '2026-09-18', reason: '管理员不走申请流程',
    });
    assert.equal(adminCannotApply.status, 403);

    const mine = await applicant.get('/api/release-time-change-requests/mine');
    assert.equal(mine.status, 200, mine.text);
    assert.equal(mine.body.requests[0].requestedReleaseTime, '2026-09-11');
    const pending = await admin.get('/api/admin/release-time-change-requests');
    assert.equal(pending.status, 200, pending.text);
    assert.equal(pending.body.requests.length, 1);

    const approved = await admin.post(`/api/admin/release-time-change-requests/${created.body.request.id}/review`).send({ decision: 'APPROVE', comment: '同意调整' });
    assert.equal(approved.status, 200, approved.text);
    assert.equal(getDb().prepare('SELECT release_time FROM skill_versions WHERE id = ?').get(version.id).release_time, '2026-09-11');
    assert.ok(getDb().prepare("SELECT id FROM audit_logs WHERE action = 'APPROVE_RELEASE_TIME_CHANGE' AND target_id = ?").get(String(created.body.request.id)));
  });

  test('管理员驳回申请不会变更日期，直接调整会自动终止待审申请', async () => {
    createUser('reject-applicant', 'EDITOR');
    const applicant = await login('reject-applicant');
    const admin = await login('admin', 'AdminPass123');
    const versions = getDb().prepare("SELECT id, release_time FROM skill_versions WHERE status = 'APPROVED' ORDER BY created_at LIMIT 2").all();

    const rejectedRequest = await applicant.post(`/api/versions/${versions[0].id}/release-time-change-requests`).send({ releaseTime: '2026-09-11', reason: '申请延后投产' });
    const missingComment = await admin.post(`/api/admin/release-time-change-requests/${rejectedRequest.body.request.id}/review`).send({ decision: 'REJECT', comment: '' });
    assert.equal(missingComment.status, 400);
    const rejected = await admin.post(`/api/admin/release-time-change-requests/${rejectedRequest.body.request.id}/review`).send({ decision: 'REJECT', comment: '当前窗口不允许调整' });
    assert.equal(rejected.status, 200, rejected.text);
    assert.equal(getDb().prepare('SELECT release_time FROM skill_versions WHERE id = ?').get(versions[0].id).release_time, versions[0].release_time);

    const supersededRequest = await applicant.post(`/api/versions/${versions[1].id}/release-time-change-requests`).send({ releaseTime: '2026-09-18', reason: '申请另一个窗口' });
    assert.equal(supersededRequest.status, 201, supersededRequest.text);
    const direct = await admin.patch(`/api/admin/versions/${versions[1].id}/release-time`).send({ releaseTime: '2026-08-28' });
    assert.equal(direct.status, 200, direct.text);
    const state = getDb().prepare('SELECT status, review_comment FROM release_time_change_requests WHERE id = ?').get(supersededRequest.body.request.id);
    assert.equal(state.status, 'REJECTED');
    assert.match(state.review_comment, /管理员已直接调整/);
  });

  test('非周五日期不能保存或提交', async () => {
    createUser('friday-editor', 'EDITOR');
    const editor = await login('friday-editor');
    const draftResponse = await editor.post('/api/skills/customer-prescreen/drafts').send({});
    const draft = (await editor.get(`/api/drafts/${draftResponse.body.draftId}`)).body.version;
    const files = draft.files.map(({ path: filePath, content }) => ({ path: filePath, content }));
    const saved = await editor.patch(`/api/drafts/${draft.id}`).send({ revision: draft.revision, files, summary: '错误日期', releaseTime: '2026-08-29' });
    assert.equal(saved.status, 400);
    assert.match(saved.body.error, /星期五/);
    const submitted = await editor.post(`/api/drafts/${draft.id}/submit`).send({ revision: draft.revision, summary: '错误日期', releaseTime: '2026-08-29' });
    assert.equal(submitted.status, 400);
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
    const submitted = await editor.post(`/api/drafts/${draft.id}/submit`).send({ revision: draft.revision, summary: '回滚到初始业务规则', releaseTime: '2026-10-16' });
    assert.equal(submitted.status, 200, submitted.text);
    assert.equal(submitted.body.version.versionNo, 3);
    assert.equal(getDb().prepare("SELECT current_published_version_id AS id FROM skills WHERE slug = 'customer-prescreen'").get().id, changed.id);

    const approved = await reviewer.post(`/api/versions/${draft.id}/review`).send({ decision: 'APPROVE', comment: '确认回滚' });
    assert.equal(approved.status, 200, approved.text);
    assert.equal(getDb().prepare("SELECT current_published_version_id AS id FROM skills WHERE slug = 'customer-prescreen'").get().id, draft.id);
    assert.equal(getDb().prepare("SELECT COUNT(*) AS count FROM skill_versions WHERE skill_id = ? AND status = 'APPROVED'").get(draft.skillId).count, 3);
  });
});
