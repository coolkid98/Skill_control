import { ValidationError } from './validation.js';

export function getClientIp(req) {
  return req.ip || req.socket?.remoteAddress || null;
}

export function notFound(req, res) {
  res.status(404).json({ error: '接口不存在' });
}

export function errorHandler(error, req, res, next) {
  if (res.headersSent) return next(error);
  if (error instanceof ValidationError) {
    return res.status(400).json({ error: error.message, details: error.details });
  }
  if (error?.code === 'SQLITE_CONSTRAINT_UNIQUE') {
    return res.status(409).json({ error: '数据已存在或发生版本冲突' });
  }
  if (!error.expose) console.error('[server]', error);
  return res.status(error.status || 500).json({ error: error.expose ? error.message : '服务器处理请求失败' });
}

export function httpError(status, message, code) {
  const error = new Error(message);
  error.status = status;
  error.expose = true;
  error.code = code;
  return error;
}
