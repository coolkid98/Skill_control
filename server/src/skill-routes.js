import express from 'express';
import archiver from 'archiver';
import { diffLines } from 'diff';
import { nanoid } from 'nanoid';
import {
  CHANGE_TYPES,
  ROLES,
  VERSION_STATUSES,
} from './constants.js';
import { requireAuth, requireRole } from './auth.js';
import { auditLog, getDb, insertVersionFiles } from './db.js';
import { getClientIp, httpError } from './http.js';
import {
  computeSnapshotHash,
  validateFiles,
  validateSlug,
} from './validation.js';

export const skillRouter = express.Router();

function filesForVersion(versionId) {
  return getDb().prepare(`
    SELECT path, content, content_hash AS contentHash, size
    FROM version_files WHERE version_id = ? ORDER BY path
  `).all(versionId);
}

function mapVersion(row, includeFiles = false) {
  if (!row) return null;
  const result = {
    id: row.id,
    skillId: row.skill_id,
    slug: row.slug,
    versionNo: row.version_no,
    status: row.status,
    changeType: row.change_type,
    sourceVersionId: row.source_version_id,
    basePublishedVersionId: row.base_published_version_id,
    summary: row.summary,
    revision: row.revision,
    createdBy: row.created_by,
    creatorName: row.creator_name || row.creator_username,
    createdAt: row.created_at,
    submittedAt: row.submitted_at,
    reviewedAt: row.reviewed_at,
    reviewDecision: row.review_decision,
    reviewComment: row.review_comment,
    reviewerName: row.reviewer_name,
    stale: row.status === 'DRAFT' && row.base_published_version_id !== row.current_published_version_id,
  };
  if (includeFiles) result.files = filesForVersion(row.id);
  return result;
}

const VERSION_SELECT = `
  SELECT v.*, s.slug, s.current_published_version_id,
         creator.username AS creator_username, creator.display_name AS creator_name,
         r.decision AS review_decision, r.comment AS review_comment,
         reviewer.display_name AS reviewer_name
  FROM skill_versions v
  JOIN skills s ON s.id = v.skill_id
  LEFT JOIN users creator ON creator.id = v.created_by
  LEFT JOIN reviews r ON r.version_id = v.id
  LEFT JOIN users reviewer ON reviewer.id = r.reviewer_id
`;

function getVersion(id) {
  return getDb().prepare(`${VERSION_SELECT} WHERE v.id = ?`).get(id);
}

function assertDraftOwner(row, user) {
  if (!row) throw httpError(404, '草稿不存在');
  if (row.status !== VERSION_STATUSES.DRAFT) throw httpError(409, '该版本已提交，不能继续编辑');
  if (row.created_by !== user.id) throw httpError(403, '只能编辑自己的草稿');
}

function assertVersionVisible(row, user) {
  if (!row) throw httpError(404, '版本不存在');
  if (row.status === VERSION_STATUSES.DRAFT && row.created_by !== user.id && user.role !== ROLES.ADMIN) {
    throw httpError(403, '无权查看他人的草稿');
  }
}

skillRouter.get('/dashboard', requireAuth, (req, res) => {
  const db = getDb();
  const stats = {
    skills: db.prepare('SELECT COUNT(*) AS count FROM skills WHERE current_published_version_id IS NOT NULL').get().count,
    pending: db.prepare("SELECT COUNT(*) AS count FROM skill_versions WHERE status = 'SUBMITTED'").get().count,
    myDrafts: db.prepare("SELECT COUNT(*) AS count FROM skill_versions WHERE status = 'DRAFT' AND created_by = ?").get(req.user.id).count,
    approvedVersions: db.prepare("SELECT COUNT(*) AS count FROM skill_versions WHERE status = 'APPROVED'").get().count,
  };
  const recent = db.prepare(`${VERSION_SELECT}
    WHERE v.status != 'DRAFT' OR v.created_by = ?
    ORDER BY COALESCE(v.reviewed_at, v.submitted_at, v.created_at) DESC LIMIT 8
  `).all(req.user.id).map((row) => mapVersion(row));
  res.json({ stats, recent });
});

skillRouter.get('/skills', requireAuth, (req, res) => {
  const search = String(req.query.search || '').trim();
  const rows = getDb().prepare(`
    SELECT s.id, s.slug, s.current_published_version_id, s.created_at,
           pub.version_no AS current_version_no, pub.reviewed_at AS published_at,
           (SELECT COUNT(*) FROM skill_versions p WHERE p.skill_id = s.id AND p.status = 'SUBMITTED') AS pending_count,
           (SELECT id FROM skill_versions d WHERE d.skill_id = s.id AND d.status = 'DRAFT' AND d.created_by = ? ORDER BY d.created_at DESC LIMIT 1) AS my_draft_id,
           (SELECT content FROM version_files f WHERE f.version_id = s.current_published_version_id AND f.path = 'SKILL.md') AS skill_content
    FROM skills s LEFT JOIN skill_versions pub ON pub.id = s.current_published_version_id
    WHERE (? = '' OR s.slug LIKE '%' || ? || '%')
    ORDER BY s.slug
  `).all(req.user.id, search, search);
  const skills = rows.map((row) => ({
    id: row.id,
    slug: row.slug,
    currentPublishedVersionId: row.current_published_version_id,
    currentVersionNo: row.current_version_no,
    publishedAt: row.published_at,
    pendingCount: row.pending_count,
    myDraftId: row.my_draft_id,
    description: extractDescription(row.skill_content),
    createdAt: row.created_at,
  }));
  res.json({ skills });
});

skillRouter.post('/skills', ...requireRole(ROLES.EDITOR), (req, res) => {
  const slug = String(req.body?.slug || '').trim();
  validateSlug(slug);
  const db = getDb();
  if (db.prepare('SELECT id FROM skills WHERE slug = ? COLLATE NOCASE').get(slug)) return res.status(409).json({ error: '该 Skill 名称已存在' });
  const now = Date.now();
  const skillId = nanoid();
  const draftId = nanoid();
  const template = `---\nname: ${slug}\ndescription: 请填写该 Skill 的用途和触发场景\n---\n\n# ${slug}\n\n请在此编写 Skill 说明。\n`;
  db.transaction(() => {
    db.prepare('INSERT INTO skills(id, slug, created_by, created_at) VALUES (?, ?, ?, ?)').run(skillId, slug, req.user.id, now);
    db.prepare(`
      INSERT INTO skill_versions(id, skill_id, status, change_type, revision, created_by, created_at)
      VALUES (?, ?, 'DRAFT', 'CREATE', 0, ?, ?)
    `).run(draftId, skillId, req.user.id, now);
    insertVersionFiles(draftId, [{ path: 'SKILL.md', content: template }]);
    auditLog({ actorId: req.user.id, action: 'CREATE_SKILL_DRAFT', targetType: 'SKILL_VERSION', targetId: draftId, metadata: { slug }, ip: getClientIp(req) });
  })();
  res.status(201).json({ skill: { id: skillId, slug }, draftId });
});

skillRouter.get('/skills/:slug', requireAuth, (req, res) => {
  const skill = getDb().prepare(`
    SELECT s.*, pub.version_no AS current_version_no, pub.reviewed_at AS published_at
    FROM skills s LEFT JOIN skill_versions pub ON pub.id = s.current_published_version_id
    WHERE s.slug = ? COLLATE NOCASE
  `).get(req.params.slug);
  if (!skill) return res.status(404).json({ error: 'Skill 不存在' });
  const versions = getDb().prepare(`${VERSION_SELECT}
    WHERE v.skill_id = ? AND (v.status != 'DRAFT' OR v.created_by = ?)
    ORDER BY COALESCE(v.version_no, 999999) DESC, v.created_at DESC
  `).all(skill.id, req.user.id).map((row) => mapVersion(row));
  const currentFiles = skill.current_published_version_id ? filesForVersion(skill.current_published_version_id) : [];
  res.json({
    skill: {
      id: skill.id,
      slug: skill.slug,
      currentPublishedVersionId: skill.current_published_version_id,
      currentVersionNo: skill.current_version_no,
      publishedAt: skill.published_at,
      description: extractDescription(currentFiles.find((file) => file.path === 'SKILL.md')?.content),
    },
    currentFiles,
    versions,
  });
});

skillRouter.post('/skills/:slug/drafts', ...requireRole(ROLES.EDITOR), (req, res) => {
  const db = getDb();
  const skill = db.prepare('SELECT * FROM skills WHERE slug = ? COLLATE NOCASE').get(req.params.slug);
  if (!skill) return res.status(404).json({ error: 'Skill 不存在' });
  const existing = db.prepare("SELECT id FROM skill_versions WHERE skill_id = ? AND status = 'DRAFT' AND created_by = ? ORDER BY created_at DESC LIMIT 1").get(skill.id, req.user.id);
  if (existing) return res.status(409).json({ error: '你已经有一个未提交草稿', draftId: existing.id });
  let sourceVersionId = req.body?.sourceVersionId || skill.current_published_version_id;
  const requestedRollback = Boolean(req.body?.rollback);
  if (sourceVersionId) {
    const source = db.prepare('SELECT * FROM skill_versions WHERE id = ? AND skill_id = ?').get(sourceVersionId, skill.id);
    if (!source || source.status === VERSION_STATUSES.DRAFT) return res.status(400).json({ error: '源版本不存在或不可复制' });
    if (requestedRollback && source.status !== VERSION_STATUSES.APPROVED) return res.status(400).json({ error: '只能回滚到已批准版本' });
  } else if (skill.current_published_version_id) {
    sourceVersionId = skill.current_published_version_id;
  }
  const draftId = nanoid();
  const now = Date.now();
  const changeType = requestedRollback ? CHANGE_TYPES.ROLLBACK : (skill.current_published_version_id ? CHANGE_TYPES.UPDATE : CHANGE_TYPES.CREATE);
  const files = sourceVersionId ? filesForVersion(sourceVersionId) : [];
  db.transaction(() => {
    db.prepare(`
      INSERT INTO skill_versions(id, skill_id, status, change_type, source_version_id, base_published_version_id, revision, created_by, created_at)
      VALUES (?, ?, 'DRAFT', ?, ?, ?, 0, ?, ?)
    `).run(draftId, skill.id, changeType, sourceVersionId, skill.current_published_version_id, req.user.id, now);
    insertVersionFiles(draftId, files);
    auditLog({ actorId: req.user.id, action: requestedRollback ? 'CREATE_ROLLBACK_DRAFT' : 'CREATE_DRAFT', targetType: 'SKILL_VERSION', targetId: draftId, metadata: { slug: skill.slug, sourceVersionId }, ip: getClientIp(req) });
  })();
  res.status(201).json({ draftId });
});

skillRouter.get('/drafts/:id', ...requireRole(ROLES.EDITOR), (req, res, next) => {
  try {
    const row = getVersion(req.params.id);
    assertDraftOwner(row, req.user);
    res.json({ version: mapVersion(row, true) });
  } catch (error) { next(error); }
});

skillRouter.patch('/drafts/:id', ...requireRole(ROLES.EDITOR), (req, res, next) => {
  try {
    const db = getDb();
    const row = getVersion(req.params.id);
    assertDraftOwner(row, req.user);
    const expectedRevision = Number(req.body?.revision);
    if (!Number.isInteger(expectedRevision) || expectedRevision !== row.revision) return res.status(409).json({ error: '草稿已被更新，请刷新后重试', currentRevision: row.revision });
    const files = req.body?.files;
    validateFiles(files, row.slug, { strict: false });
    const summary = req.body?.summary == null ? row.summary : String(req.body.summary).slice(0, 500);
    const result = db.transaction(() => {
      const changed = db.prepare("UPDATE skill_versions SET summary = ?, revision = revision + 1 WHERE id = ? AND status = 'DRAFT' AND revision = ?")
        .run(summary, row.id, expectedRevision);
      if (changed.changes !== 1) return false;
      db.prepare('DELETE FROM version_files WHERE version_id = ?').run(row.id);
      insertVersionFiles(row.id, files);
      auditLog({ actorId: req.user.id, action: 'SAVE_DRAFT', targetType: 'SKILL_VERSION', targetId: row.id, metadata: { fileCount: files.length }, ip: getClientIp(req) });
      return true;
    })();
    if (!result) return res.status(409).json({ error: '草稿已被更新，请刷新后重试' });
    const updated = getVersion(row.id);
    return res.json({ version: mapVersion(updated, true) });
  } catch (error) { return next(error); }
});

skillRouter.delete('/drafts/:id', ...requireRole(ROLES.EDITOR), (req, res, next) => {
  try {
    const db = getDb();
    const row = getVersion(req.params.id);
    assertDraftOwner(row, req.user);
    db.transaction(() => {
      db.prepare('DELETE FROM skill_versions WHERE id = ?').run(row.id);
      const hasVersions = db.prepare('SELECT COUNT(*) AS count FROM skill_versions WHERE skill_id = ?').get(row.skill_id).count;
      if (hasVersions === 0) db.prepare('DELETE FROM skills WHERE id = ? AND current_published_version_id IS NULL').run(row.skill_id);
      auditLog({ actorId: req.user.id, action: 'DISCARD_DRAFT', targetType: 'SKILL_VERSION', targetId: row.id, metadata: { slug: row.slug }, ip: getClientIp(req) });
    })();
    res.status(204).end();
  } catch (error) { next(error); }
});

skillRouter.post('/drafts/:id/submit', ...requireRole(ROLES.EDITOR), (req, res, next) => {
  try {
    const db = getDb();
    const row = getVersion(req.params.id);
    assertDraftOwner(row, req.user);
    const expectedRevision = Number(req.body?.revision);
    if (expectedRevision !== row.revision) return res.status(409).json({ error: '请先保存最新草稿再提交' });
    const summary = String(req.body?.summary || row.summary || '').trim();
    if (summary.length < 2 || summary.length > 500) return res.status(400).json({ error: '请填写 2-500 字的变更说明' });
    const files = filesForVersion(row.id);
    validateFiles(files, row.slug, { strict: true });
    const outcome = db.transaction(() => {
      const current = db.prepare('SELECT current_published_version_id FROM skills WHERE id = ?').get(row.skill_id);
      if (current.current_published_version_id !== row.base_published_version_id) return { stale: true };
      const versionNo = db.prepare('SELECT COALESCE(MAX(version_no), 0) + 1 AS next FROM skill_versions WHERE skill_id = ?').get(row.skill_id).next;
      const now = Date.now();
      db.prepare(`
        UPDATE skill_versions SET status = 'SUBMITTED', version_no = ?, summary = ?, revision = revision + 1, submitted_at = ?
        WHERE id = ? AND status = 'DRAFT'
      `).run(versionNo, summary, now, row.id);
      auditLog({ actorId: req.user.id, action: 'SUBMIT_VERSION', targetType: 'SKILL_VERSION', targetId: row.id, metadata: { slug: row.slug, versionNo, summary }, ip: getClientIp(req) });
      return { versionNo };
    })();
    if (outcome.stale) return res.status(409).json({ error: '当前已发布版本已变化，请从最新版本重新创建草稿', code: 'STALE_BASE' });
    return res.json({ version: mapVersion(getVersion(row.id)) });
  } catch (error) { return next(error); }
});

skillRouter.get('/versions', requireAuth, (req, res) => {
  const status = String(req.query.status || '');
  const valid = Object.values(VERSION_STATUSES).includes(status);
  let sql = `${VERSION_SELECT} WHERE (v.status != 'DRAFT' OR v.created_by = ?)`;
  const params = [req.user.id];
  if (valid) { sql += ' AND v.status = ?'; params.push(status); }
  sql += ' ORDER BY COALESCE(v.submitted_at, v.created_at) DESC LIMIT 200';
  const versions = getDb().prepare(sql).all(...params).map((row) => mapVersion(row));
  res.json({ versions });
});

skillRouter.get('/versions/:id', requireAuth, (req, res, next) => {
  try {
    const row = getVersion(req.params.id);
    assertVersionVisible(row, req.user);
    res.json({ version: mapVersion(row, true) });
  } catch (error) { next(error); }
});

skillRouter.get('/versions/:id/diff', requireAuth, (req, res, next) => {
  try {
    const row = getVersion(req.params.id);
    assertVersionVisible(row, req.user);
    const before = row.base_published_version_id ? filesForVersion(row.base_published_version_id) : [];
    const after = filesForVersion(row.id);
    res.json({ diff: buildFileDiff(before, after), baseVersionId: row.base_published_version_id });
  } catch (error) { next(error); }
});

skillRouter.post('/versions/:id/review', ...requireRole(ROLES.REVIEWER), (req, res, next) => {
  try {
    const decision = String(req.body?.decision || '');
    const comment = String(req.body?.comment || '').trim();
    if (!['APPROVE', 'REJECT'].includes(decision)) return res.status(400).json({ error: '审核决定不合法' });
    if (decision === 'REJECT' && comment.length < 2) return res.status(400).json({ error: '驳回时必须填写原因' });
    if (comment.length > 1000) return res.status(400).json({ error: '审核意见不能超过 1000 个字符' });
    const db = getDb();
    const outcome = db.transaction(() => {
      const row = getVersion(req.params.id);
      if (!row) return { notFound: true };
      if (row.status !== VERSION_STATUSES.SUBMITTED) return { conflict: true };
      if (row.created_by === req.user.id) return { self: true };
      const now = Date.now();
      if (decision === 'APPROVE') {
        const current = db.prepare('SELECT current_published_version_id FROM skills WHERE id = ?').get(row.skill_id);
        if (current.current_published_version_id !== row.base_published_version_id) {
          db.prepare("UPDATE skill_versions SET status = 'SUPERSEDED', reviewed_at = ? WHERE id = ?").run(now, row.id);
          auditLog({ actorId: req.user.id, action: 'SUPERSEDE_STALE_VERSION', targetType: 'SKILL_VERSION', targetId: row.id, ip: getClientIp(req) });
          return { stale: true };
        }
        db.prepare("UPDATE skill_versions SET status = 'APPROVED', reviewed_at = ? WHERE id = ?").run(now, row.id);
        db.prepare('UPDATE skills SET current_published_version_id = ? WHERE id = ?').run(row.id, row.skill_id);
        db.prepare(`
          UPDATE skill_versions SET status = 'SUPERSEDED', reviewed_at = ?
          WHERE skill_id = ? AND status = 'SUBMITTED' AND id != ? AND base_published_version_id IS ?
        `).run(now, row.skill_id, row.id, row.base_published_version_id);
      } else {
        db.prepare("UPDATE skill_versions SET status = 'REJECTED', reviewed_at = ? WHERE id = ?").run(now, row.id);
      }
      db.prepare('INSERT INTO reviews(version_id, reviewer_id, decision, comment, created_at) VALUES (?, ?, ?, ?, ?)')
        .run(row.id, req.user.id, decision, comment || null, now);
      auditLog({ actorId: req.user.id, action: decision === 'APPROVE' ? 'APPROVE_VERSION' : 'REJECT_VERSION', targetType: 'SKILL_VERSION', targetId: row.id, metadata: { slug: row.slug, versionNo: row.version_no, comment }, ip: getClientIp(req) });
      return { ok: true };
    })();
    if (outcome.notFound) return res.status(404).json({ error: '版本不存在' });
    if (outcome.conflict) return res.status(409).json({ error: '该版本已经处理' });
    if (outcome.self) return res.status(403).json({ error: '不能审核自己提交的版本' });
    if (outcome.stale) return res.status(409).json({ error: '该版本基线已过期，已标记为过期版本', code: 'STALE_BASE' });
    return res.json({ version: mapVersion(getVersion(req.params.id)) });
  } catch (error) { return next(error); }
});

skillRouter.get('/exports/current.zip', requireAuth, (req, res, next) => {
  try {
    const rows = getDb().prepare(`${VERSION_SELECT} JOIN skills current_skill ON current_skill.current_published_version_id = v.id WHERE v.status = 'APPROVED' ORDER BY s.slug`).all();
    const manifest = {
      exportedAt: new Date().toISOString(),
      format: 'skill-control-export-v1',
      skills: rows.map((row) => {
        const files = filesForVersion(row.id);
        return { slug: row.slug, version: row.version_no, versionId: row.id, approvedAt: row.reviewed_at, approvedBy: row.reviewer_name || '系统初始化', sha256: computeSnapshotHash(files) };
      }),
    };
    const entries = rows.flatMap((row) => filesForVersion(row.id).map((file) => ({ name: `skills/${row.slug}/${file.path}`, content: file.content })));
    auditLog({ actorId: req.user.id, action: 'EXPORT_CURRENT_BUNDLE', targetType: 'EXPORT', metadata: { skills: manifest.skills.map((skill) => `${skill.slug}@v${skill.version}`) }, ip: getClientIp(req) });
    streamZip(res, `skills-published-${dateStamp()}.zip`, entries, manifest);
  } catch (error) { next(error); }
});

skillRouter.get('/versions/:id/export.zip', requireAuth, (req, res, next) => {
  try {
    const row = getVersion(req.params.id);
    if (!row || row.status !== VERSION_STATUSES.APPROVED) return res.status(404).json({ error: '只能导出已批准版本' });
    const files = filesForVersion(row.id);
    const manifest = {
      exportedAt: new Date().toISOString(),
      format: 'skill-control-export-v1',
      skills: [{ slug: row.slug, version: row.version_no, versionId: row.id, approvedAt: row.reviewed_at, approvedBy: row.reviewer_name || '系统初始化', sha256: computeSnapshotHash(files) }],
    };
    const entries = files.map((file) => ({ name: `skills/${row.slug}/${file.path}`, content: file.content }));
    auditLog({ actorId: req.user.id, action: 'EXPORT_SKILL_VERSION', targetType: 'SKILL_VERSION', targetId: row.id, metadata: { slug: row.slug, versionNo: row.version_no }, ip: getClientIp(req) });
    streamZip(res, `${row.slug}-v${row.version_no}.zip`, entries, manifest);
  } catch (error) { next(error); }
});

function extractDescription(content) {
  if (!content) return '';
  const match = content.match(/^---\s*\r?\n[\s\S]*?^description:\s*(.+)$/m);
  return match ? match[1].trim().replace(/^['"]|['"]$/g, '') : '';
}

function buildFileDiff(beforeFiles, afterFiles) {
  const before = new Map(beforeFiles.map((file) => [file.path, file.content]));
  const after = new Map(afterFiles.map((file) => [file.path, file.content]));
  const paths = [...new Set([...before.keys(), ...after.keys()])].sort();
  return paths.map((path) => {
    const oldContent = before.get(path);
    const newContent = after.get(path);
    const status = oldContent == null ? 'ADDED' : newContent == null ? 'DELETED' : oldContent === newContent ? 'UNCHANGED' : 'MODIFIED';
    const changes = status === 'UNCHANGED' ? [] : diffLines(oldContent || '', newContent || '').map((part) => ({
      type: part.added ? 'added' : part.removed ? 'removed' : 'context',
      value: part.value,
      count: part.count,
    }));
    return { path, status, changes };
  }).filter((file) => file.status !== 'UNCHANGED');
}

function dateStamp() {
  return new Date().toISOString().replace(/[-:]/g, '').replace(/T/, '-').slice(0, 15);
}

function streamZip(res, filename, entries, manifest) {
  res.attachment(filename);
  res.type('application/zip');
  const archive = archiver('zip', { zlib: { level: 9 } });
  archive.on('error', (error) => res.destroy(error));
  archive.pipe(res);
  for (const entry of entries) archive.append(entry.content, { name: entry.name });
  archive.append(`${JSON.stringify(manifest, null, 2)}\n`, { name: 'manifest.json' });
  archive.finalize();
}

export { buildFileDiff, filesForVersion, getVersion, mapVersion };
