import path from 'node:path';
import express from 'express';
import { requireAuth } from './auth.js';
import { auditLog, getDb } from './db.js';
import { getClientIp, httpError } from './http.js';
import { computeContentHash } from './validation.js';

const TOOL_CATALOG_UPLOADER = 'Chent';
const MAX_TOOL_DOCUMENT_SIZE = 1024 * 1024;

export const toolRouter = express.Router();

function canUpload(user) {
  return user?.username === TOOL_CATALOG_UPLOADER;
}

function mapDocument(row) {
  if (!row) return null;
  return {
    filename: row.filename,
    content: row.content,
    contentHash: row.content_hash,
    size: row.size,
    uploadedBy: row.uploader_name || row.uploader_username,
    uploadedAt: row.uploaded_at,
  };
}

function getDocument() {
  return getDb().prepare(`
    SELECT d.*, uploader.username AS uploader_username, uploader.display_name AS uploader_name
    FROM tool_documents d
    JOIN users uploader ON uploader.id = d.uploaded_by
    WHERE d.id = 1
  `).get();
}

toolRouter.get('/tool-catalog', requireAuth, (req, res) => {
  res.json({ document: mapDocument(getDocument()), canUpload: canUpload(req.user) });
});

toolRouter.put('/tool-catalog', requireAuth, (req, res, next) => {
  try {
    if (req.user.must_change_password) {
      return res.status(403).json({ error: '请先修改初始密码', code: 'PASSWORD_CHANGE_REQUIRED' });
    }
    if (!canUpload(req.user)) return next(httpError(403, '只有用户名为 Chent 的用户可以上传 Tool 清单'));

    const filename = String(req.body?.filename || '').trim();
    const content = typeof req.body?.content === 'string' ? req.body.content : '';
    if (!filename || filename.length > 160 || filename !== path.basename(filename) || /[\\/\0]/.test(filename) || !/\.md$/i.test(filename)) {
      return res.status(400).json({ error: '只能上传文件名有效的 .md 文件' });
    }
    if (!content.trim()) return res.status(400).json({ error: 'Markdown 文件内容不能为空' });
    const size = Buffer.byteLength(content, 'utf8');
    if (size > MAX_TOOL_DOCUMENT_SIZE) return res.status(413).json({ error: 'Markdown 文件不能超过 1 MiB' });

    const now = Date.now();
    const contentHash = computeContentHash(content);
    const db = getDb();
    db.transaction(() => {
      db.prepare(`
        INSERT INTO tool_documents(id, filename, content, content_hash, size, uploaded_by, uploaded_at)
        VALUES (1, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET
          filename = excluded.filename,
          content = excluded.content,
          content_hash = excluded.content_hash,
          size = excluded.size,
          uploaded_by = excluded.uploaded_by,
          uploaded_at = excluded.uploaded_at
      `).run(filename, content, contentHash, size, req.user.id, now);
      auditLog({
        actorId: req.user.id,
        action: 'UPLOAD_TOOL_CATALOG',
        targetType: 'TOOL_DOCUMENT',
        targetId: '1',
        metadata: { filename, size, contentHash },
        ip: getClientIp(req),
      });
    })();

    return res.json({ document: mapDocument(getDocument()), canUpload: true });
  } catch (error) {
    return next(error);
  }
});
