import express from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import rateLimit from 'express-rate-limit';
import { config } from './config.js';
import { COOKIE_NAME } from './constants.js';
import { auditLog, getDb } from './db.js';
import { getClientIp, httpError } from './http.js';

export const authRouter = express.Router();

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  standardHeaders: true,
  legacyHeaders: false,
  skip: () => process.env.NODE_ENV === 'test',
  message: { error: '登录尝试过于频繁，请稍后再试' },
});

function publicUser(row) {
  return {
    id: row.id,
    username: row.username,
    displayName: row.display_name,
    role: row.role,
    status: row.status,
    mustChangePassword: Boolean(row.must_change_password),
    createdAt: row.created_at,
  };
}

function sessionCookieOptions() {
  return {
    httpOnly: true,
    sameSite: 'strict',
    secure: config.cookieSecure,
    maxAge: config.sessionTtlHours * 60 * 60 * 1000,
    path: '/',
  };
}

authRouter.post('/login', loginLimiter, (req, res) => {
  const username = String(req.body?.username || '').trim();
  const password = String(req.body?.password || '');
  const row = getDb().prepare('SELECT * FROM users WHERE username = ? COLLATE NOCASE').get(username);
  if (!row || row.status !== 'ACTIVE' || !bcrypt.compareSync(password, row.password_hash)) {
    return res.status(401).json({ error: '用户名或密码错误' });
  }
  const token = jwt.sign({ sub: String(row.id), sv: row.updated_at }, config.jwtSecret, {
    expiresIn: `${config.sessionTtlHours}h`,
  });
  res.cookie(COOKIE_NAME, token, sessionCookieOptions());
  auditLog({ actorId: row.id, action: 'LOGIN', targetType: 'SESSION', ip: getClientIp(req) });
  return res.json({ user: publicUser(row) });
});

authRouter.post('/logout', optionalAuth, (req, res) => {
  res.clearCookie(COOKIE_NAME, { path: '/' });
  if (req.user) auditLog({ actorId: req.user.id, action: 'LOGOUT', targetType: 'SESSION', ip: getClientIp(req) });
  res.status(204).end();
});

authRouter.get('/me', requireAuth, (req, res) => {
  res.json({ user: publicUser(req.user) });
});

authRouter.post('/change-password', requireAuth, (req, res) => {
  const currentPassword = String(req.body?.currentPassword || '');
  const newPassword = String(req.body?.newPassword || '');
  if (!bcrypt.compareSync(currentPassword, req.user.password_hash)) {
    return res.status(400).json({ error: '当前密码不正确' });
  }
  if (newPassword.length < 10 || !/[A-Za-z]/.test(newPassword) || !/\d/.test(newPassword)) {
    return res.status(400).json({ error: '新密码至少 10 位，且必须同时包含字母和数字' });
  }
  if (currentPassword === newPassword) return res.status(400).json({ error: '新密码不能与当前密码相同' });
  const now = Date.now();
  const hash = bcrypt.hashSync(newPassword, 10);
  getDb().prepare('UPDATE users SET password_hash = ?, must_change_password = 0, updated_at = ? WHERE id = ?')
    .run(hash, now, req.user.id);
  auditLog({ actorId: req.user.id, action: 'CHANGE_PASSWORD', targetType: 'USER', targetId: String(req.user.id), ip: getClientIp(req) });
  res.clearCookie(COOKIE_NAME, { path: '/' });
  return res.json({ message: '密码已修改，请重新登录' });
});

export function optionalAuth(req, res, next) {
  const token = req.cookies?.[COOKIE_NAME];
  if (!token) return next();
  try {
    const payload = jwt.verify(token, config.jwtSecret);
    const user = getDb().prepare('SELECT * FROM users WHERE id = ?').get(Number(payload.sub));
    if (user?.status === 'ACTIVE' && user.updated_at === payload.sv) req.user = user;
  } catch {}
  return next();
}

export function requireAuth(req, res, next) {
  optionalAuth(req, res, () => {
    if (!req.user) return res.status(401).json({ error: '登录已失效，请重新登录' });
    return next();
  });
}

export function requireRole(...roles) {
  return [requireAuth, (req, res, next) => {
    if (req.user.must_change_password) return res.status(403).json({ error: '请先修改初始密码', code: 'PASSWORD_CHANGE_REQUIRED' });
    if (!roles.includes(req.user.role)) return next(httpError(403, '无权执行此操作'));
    return next();
  }];
}

export { publicUser };
