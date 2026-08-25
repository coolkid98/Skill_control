import express from 'express';
import bcrypt from 'bcryptjs';
import { ROLES, USER_STATUSES } from './constants.js';
import { auditLog, getDb } from './db.js';
import { requireRole, publicUser } from './auth.js';
import { getClientIp } from './http.js';
import { validateReleaseTime } from './validation.js';

export const adminRouter = express.Router();
adminRouter.use(...requireRole(ROLES.ADMIN));

adminRouter.get('/users', (req, res) => {
  const users = getDb().prepare('SELECT * FROM users ORDER BY created_at DESC').all().map(publicUser);
  res.json({ users });
});

adminRouter.get('/password-reset-requests', (req, res) => {
  const requests = getDb().prepare(`
    SELECT p.id, p.user_id, p.requested_at,
           u.username, u.display_name, u.role, u.status AS user_status
    FROM password_reset_requests p
    JOIN users u ON u.id = p.user_id
    WHERE p.status = 'PENDING'
    ORDER BY p.requested_at ASC
  `).all().map((row) => ({
    id: row.id,
    userId: row.user_id,
    username: row.username,
    displayName: row.display_name,
    role: row.role,
    userStatus: row.user_status,
    requestedAt: row.requested_at,
  }));
  res.json({ requests });
});

adminRouter.post('/users', (req, res) => {
  const username = String(req.body?.username || '').trim();
  const displayName = String(req.body?.displayName || '').trim();
  const role = String(req.body?.role || '');
  const temporaryPassword = String(req.body?.temporaryPassword || '');
  if (!/^[A-Za-z0-9_.-]{2,40}$/.test(username)) return res.status(400).json({ error: '用户名需为 2-40 位字母、数字、点、下划线或连字符' });
  if (!displayName || displayName.length > 60) return res.status(400).json({ error: '姓名不能为空且不能超过 60 个字符' });
  if (!Object.values(ROLES).includes(role)) return res.status(400).json({ error: '角色不合法' });
  if (temporaryPassword.length < 10 || !/[A-Za-z]/.test(temporaryPassword) || !/\d/.test(temporaryPassword)) {
    return res.status(400).json({ error: '临时密码至少 10 位，且必须同时包含字母和数字' });
  }
  const now = Date.now();
  try {
    const result = getDb().prepare(`
      INSERT INTO users(username, password_hash, display_name, role, status, must_change_password, created_by, created_at, updated_at)
      VALUES (?, ?, ?, ?, 'ACTIVE', 1, ?, ?, ?)
    `).run(username, bcrypt.hashSync(temporaryPassword, 10), displayName, role, req.user.id, now, now);
    auditLog({ actorId: req.user.id, action: 'CREATE_USER', targetType: 'USER', targetId: String(result.lastInsertRowid), metadata: { username, role }, ip: getClientIp(req) });
    const created = getDb().prepare('SELECT * FROM users WHERE id = ?').get(Number(result.lastInsertRowid));
    return res.status(201).json({ user: publicUser(created) });
  } catch (error) {
    if (error.code === 'SQLITE_CONSTRAINT_UNIQUE') return res.status(409).json({ error: '用户名已存在' });
    throw error;
  }
});

adminRouter.patch('/users/:id', (req, res) => {
  const id = Number(req.params.id);
  const target = getDb().prepare('SELECT * FROM users WHERE id = ?').get(id);
  if (!target) return res.status(404).json({ error: '用户不存在' });
  const role = req.body?.role ?? target.role;
  const status = req.body?.status ?? target.status;
  if (!Object.values(ROLES).includes(role) || !Object.values(USER_STATUSES).includes(status)) return res.status(400).json({ error: '角色或状态不合法' });
  if (id === req.user.id && status === 'DISABLED') return res.status(400).json({ error: '不能停用当前登录账号' });
  if (target.role === 'ADMIN' && (role !== 'ADMIN' || status !== 'ACTIVE')) {
    const activeAdmins = getDb().prepare("SELECT COUNT(*) AS count FROM users WHERE role = 'ADMIN' AND status = 'ACTIVE'").get().count;
    if (activeAdmins <= 1) return res.status(400).json({ error: '必须至少保留一个启用的管理员' });
  }
  const now = Date.now();
  getDb().prepare('UPDATE users SET role = ?, status = ?, updated_at = ? WHERE id = ?').run(role, status, now, id);
  auditLog({ actorId: req.user.id, action: 'UPDATE_USER', targetType: 'USER', targetId: String(id), metadata: { role, status }, ip: getClientIp(req) });
  const updated = getDb().prepare('SELECT * FROM users WHERE id = ?').get(id);
  return res.json({ user: publicUser(updated) });
});

adminRouter.post('/users/:id/reset-password', (req, res) => {
  const id = Number(req.params.id);
  const temporaryPassword = String(req.body?.temporaryPassword || '');
  if (!getDb().prepare('SELECT id FROM users WHERE id = ?').get(id)) return res.status(404).json({ error: '用户不存在' });
  if (temporaryPassword.length < 10 || !/[A-Za-z]/.test(temporaryPassword) || !/\d/.test(temporaryPassword)) {
    return res.status(400).json({ error: '临时密码至少 10 位，且必须同时包含字母和数字' });
  }
  const now = Date.now();
  const db = getDb();
  db.transaction(() => {
    db.prepare('UPDATE users SET password_hash = ?, must_change_password = 1, updated_at = ? WHERE id = ?')
      .run(bcrypt.hashSync(temporaryPassword, 10), now, id);
    db.prepare(`
      UPDATE password_reset_requests
      SET status = 'RESOLVED', resolved_by = ?, resolved_at = ?
      WHERE user_id = ? AND status = 'PENDING'
    `).run(req.user.id, now, id);
    auditLog({ actorId: req.user.id, action: 'RESET_PASSWORD', targetType: 'USER', targetId: String(id), ip: getClientIp(req) });
  })();
  return res.status(204).end();
});

adminRouter.patch('/versions/:id/release-time', (req, res) => {
  const releaseTime = validateReleaseTime(req.body?.releaseTime);
  const db = getDb();
  const version = db.prepare(`
    SELECT v.id, v.status, v.release_time, v.version_no, s.slug
    FROM skill_versions v JOIN skills s ON s.id = v.skill_id
    WHERE v.id = ?
  `).get(req.params.id);
  if (!version) return res.status(404).json({ error: '版本不存在' });
  if (version.status !== 'APPROVED') return res.status(409).json({ error: '只能调整已批准版本的投产日期' });
  if (version.release_time === releaseTime) return res.json({ version: { id: version.id, releaseTime } });
  db.prepare('UPDATE skill_versions SET release_time = ? WHERE id = ?').run(releaseTime, version.id);
  auditLog({
    actorId: req.user.id,
    action: 'UPDATE_RELEASE_TIME',
    targetType: 'SKILL_VERSION',
    targetId: version.id,
    metadata: { slug: version.slug, versionNo: version.version_no, previousReleaseTime: version.release_time, releaseTime },
    ip: getClientIp(req),
  });
  return res.json({ version: { id: version.id, releaseTime } });
});

adminRouter.patch('/releases/:releaseTime', (req, res) => {
  const previousReleaseTime = validateReleaseTime(req.params.releaseTime, { fridayOnly: false });
  const releaseTime = validateReleaseTime(req.body?.releaseTime);
  const db = getDb();
  const versions = db.prepare(`
    SELECT v.id, v.version_no, s.slug
    FROM skill_versions v JOIN skills s ON s.id = v.skill_id
    WHERE v.status = 'APPROVED' AND v.release_time = ?
  `).all(previousReleaseTime);
  if (!versions.length) return res.status(404).json({ error: '原投产日期下没有已批准版本' });
  if (previousReleaseTime === releaseTime) return res.json({ updatedCount: 0, releaseTime });
  db.transaction(() => {
    db.prepare("UPDATE skill_versions SET release_time = ? WHERE status = 'APPROVED' AND release_time = ?")
      .run(releaseTime, previousReleaseTime);
    auditLog({
      actorId: req.user.id,
      action: 'UPDATE_RELEASE_BATCH',
      targetType: 'RELEASE',
      targetId: previousReleaseTime,
      metadata: {
        previousReleaseTime,
        releaseTime,
        updatedCount: versions.length,
        versions: versions.map((version) => `${version.slug}@v${version.version_no}`),
      },
      ip: getClientIp(req),
    });
  })();
  return res.json({ updatedCount: versions.length, releaseTime });
});

adminRouter.get('/audit-logs', (req, res) => {
  const limit = Math.min(Math.max(Number(req.query.limit) || 100, 1), 500);
  const logs = getDb().prepare(`
    SELECT a.*, u.username, u.display_name
    FROM audit_logs a LEFT JOIN users u ON u.id = a.actor_id
    ORDER BY a.created_at DESC LIMIT ?
  `).all(limit).map((row) => ({
    id: row.id,
    actorId: row.actor_id,
    actorName: row.display_name || row.username || '系统',
    action: row.action,
    targetType: row.target_type,
    targetId: row.target_id,
    metadata: row.metadata ? JSON.parse(row.metadata) : null,
    ip: row.ip,
    createdAt: row.created_at,
  }));
  res.json({ logs });
});
