import fs from 'node:fs';
import path from 'node:path';
import bcrypt from 'bcryptjs';
import Database from 'better-sqlite3';
import yaml from 'js-yaml';
import { nanoid } from 'nanoid';
import { config } from './config.js';
import { computeContentHash } from './validation.js';

let db;

const SCHEMA = `
CREATE TABLE IF NOT EXISTS schema_migrations (
  version INTEGER PRIMARY KEY,
  applied_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT NOT NULL UNIQUE COLLATE NOCASE,
  password_hash TEXT NOT NULL,
  display_name TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('ADMIN', 'EDITOR', 'REVIEWER')),
  status TEXT NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'DISABLED')),
  must_change_password INTEGER NOT NULL DEFAULT 1,
  created_by INTEGER,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  FOREIGN KEY (created_by) REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS skills (
  id TEXT PRIMARY KEY,
  slug TEXT NOT NULL UNIQUE COLLATE NOCASE,
  current_published_version_id TEXT,
  created_by INTEGER,
  created_at INTEGER NOT NULL,
  FOREIGN KEY (created_by) REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS skill_versions (
  id TEXT PRIMARY KEY,
  skill_id TEXT NOT NULL,
  version_no INTEGER,
  status TEXT NOT NULL CHECK (status IN ('DRAFT', 'SUBMITTED', 'APPROVED', 'REJECTED', 'SUPERSEDED')),
  change_type TEXT NOT NULL CHECK (change_type IN ('CREATE', 'UPDATE', 'ROLLBACK')),
  source_version_id TEXT,
  base_published_version_id TEXT,
  summary TEXT,
  revision INTEGER NOT NULL DEFAULT 0,
  created_by INTEGER,
  created_at INTEGER NOT NULL,
  submitted_at INTEGER,
  reviewed_at INTEGER,
  FOREIGN KEY (skill_id) REFERENCES skills(id) ON DELETE CASCADE,
  FOREIGN KEY (source_version_id) REFERENCES skill_versions(id),
  FOREIGN KEY (base_published_version_id) REFERENCES skill_versions(id),
  FOREIGN KEY (created_by) REFERENCES users(id),
  UNIQUE (skill_id, version_no)
);

CREATE TABLE IF NOT EXISTS version_files (
  version_id TEXT NOT NULL,
  path TEXT NOT NULL,
  content TEXT NOT NULL,
  content_hash TEXT NOT NULL,
  size INTEGER NOT NULL,
  PRIMARY KEY (version_id, path),
  FOREIGN KEY (version_id) REFERENCES skill_versions(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS reviews (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  version_id TEXT NOT NULL UNIQUE,
  reviewer_id INTEGER NOT NULL,
  decision TEXT NOT NULL CHECK (decision IN ('APPROVE', 'REJECT')),
  comment TEXT,
  created_at INTEGER NOT NULL,
  FOREIGN KEY (version_id) REFERENCES skill_versions(id),
  FOREIGN KEY (reviewer_id) REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS audit_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  actor_id INTEGER,
  action TEXT NOT NULL,
  target_type TEXT NOT NULL,
  target_id TEXT,
  metadata TEXT,
  ip TEXT,
  created_at INTEGER NOT NULL,
  FOREIGN KEY (actor_id) REFERENCES users(id)
);

CREATE INDEX IF NOT EXISTS idx_versions_skill_created ON skill_versions(skill_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_versions_status ON skill_versions(status, submitted_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_created ON audit_logs(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_users_status ON users(status);
`;

export function getDb() {
  if (!db) throw new Error('数据库尚未初始化');
  return db;
}

export function initDb(options = {}) {
  if (db) return db;
  const dataDir = options.dataDir || config.dataDir;
  const dbPath = options.dbPath || path.join(dataDir, 'skill-control.db');
  fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  db = new Database(dbPath);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  db.pragma('busy_timeout = 5000');
  db.exec(SCHEMA);
  db.prepare('INSERT OR IGNORE INTO schema_migrations(version, applied_at) VALUES (?, ?)').run(1, Date.now());
  applyMigrations();
  bootstrapAdmin(options.bootstrapAdmin || config.bootstrapAdmin);
  seedSkills(options.seedDir || config.seedDir);
  return db;
}

function applyMigrations() {
  const migrations = [
    {
      version: 2,
      run() {
        db.prepare(`
          UPDATE skill_versions
          SET summary = '初始版本'
          WHERE version_no = 1
            AND status = 'APPROVED'
            AND summary = '从 credit_model 当前工作区导入的初始版本'
        `).run();
      },
    },
  ];
  const apply = db.transaction((migration) => {
    const exists = db.prepare('SELECT 1 FROM schema_migrations WHERE version = ?').get(migration.version);
    if (exists) return;
    migration.run();
    db.prepare('INSERT INTO schema_migrations(version, applied_at) VALUES (?, ?)').run(migration.version, Date.now());
  });
  for (const migration of migrations) apply(migration);
}

export function closeDb() {
  if (db) {
    db.close();
    db = undefined;
  }
}

function bootstrapAdmin(admin) {
  const existing = db.prepare("SELECT id FROM users WHERE role = 'ADMIN' LIMIT 1").get();
  if (existing) return;
  if (!admin?.username || !admin?.password || admin.password.length < 8) {
    throw new Error('首次启动必须配置 BOOTSTRAP_ADMIN_USERNAME 和至少 8 位的 BOOTSTRAP_ADMIN_PASSWORD');
  }
  const now = Date.now();
  const hash = bcrypt.hashSync(admin.password, 10);
  const result = db.prepare(`
    INSERT INTO users(username, password_hash, display_name, role, status, must_change_password, created_at, updated_at)
    VALUES (?, ?, ?, 'ADMIN', 'ACTIVE', 1, ?, ?)
  `).run(admin.username.trim(), hash, admin.displayName?.trim() || '系统管理员', now, now);
  auditLog({ actorId: Number(result.lastInsertRowid), action: 'BOOTSTRAP_ADMIN', targetType: 'USER', targetId: String(result.lastInsertRowid) });
}

function seedSkills(seedDir) {
  const count = db.prepare('SELECT COUNT(*) AS count FROM skills').get().count;
  if (count > 0 || !fs.existsSync(seedDir)) return;
  const admin = db.prepare("SELECT id FROM users WHERE role = 'ADMIN' ORDER BY id LIMIT 1").get();
  const skillDirs = fs.readdirSync(seedDir, { withFileTypes: true }).filter((entry) => entry.isDirectory());
  const run = db.transaction(() => {
    for (const entry of skillDirs) {
      const skillRoot = path.join(seedDir, entry.name);
      const files = readMarkdownTree(skillRoot);
      if (!files.some((file) => file.path === 'SKILL.md')) continue;
      const frontmatter = parseSeedFrontmatter(files.find((file) => file.path === 'SKILL.md').content);
      const slug = String(frontmatter.name || entry.name);
      const skillId = nanoid();
      const versionId = nanoid();
      const now = Date.now();
      db.prepare('INSERT INTO skills(id, slug, current_published_version_id, created_by, created_at) VALUES (?, ?, ?, ?, ?)')
        .run(skillId, slug, versionId, admin?.id || null, now);
      db.prepare(`
        INSERT INTO skill_versions(id, skill_id, version_no, status, change_type, summary, revision, created_by, created_at, submitted_at, reviewed_at)
        VALUES (?, ?, 1, 'APPROVED', 'CREATE', ?, 0, ?, ?, ?, ?)
      `).run(versionId, skillId, '初始版本', admin?.id || null, now, now, now);
      insertVersionFiles(versionId, files);
      auditLog({ actorId: admin?.id, action: 'SEED_SKILL', targetType: 'SKILL_VERSION', targetId: versionId, metadata: { slug, version: 1 } });
    }
  });
  run();
}

function readMarkdownTree(root, current = '') {
  const result = [];
  for (const entry of fs.readdirSync(path.join(root, current), { withFileTypes: true })) {
    const relative = current ? `${current}/${entry.name}` : entry.name;
    if (entry.isDirectory()) result.push(...readMarkdownTree(root, relative));
    else if (entry.isFile() && entry.name.toLowerCase().endsWith('.md')) {
      result.push({ path: relative, content: fs.readFileSync(path.join(root, relative), 'utf8') });
    }
  }
  return result.sort((a, b) => a.path.localeCompare(b.path));
}

function parseSeedFrontmatter(content) {
  const match = content.match(/^---\s*\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/);
  return match ? yaml.load(match[1]) || {} : {};
}

export function insertVersionFiles(versionId, files) {
  const stmt = db.prepare('INSERT INTO version_files(version_id, path, content, content_hash, size) VALUES (?, ?, ?, ?, ?)');
  for (const file of files) {
    stmt.run(versionId, file.path, file.content, computeContentHash(file.content), Buffer.byteLength(file.content, 'utf8'));
  }
}

export function auditLog({ actorId = null, action, targetType, targetId = null, metadata = null, ip = null }) {
  if (!db) return;
  db.prepare('INSERT INTO audit_logs(actor_id, action, target_type, target_id, metadata, ip, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
    .run(actorId || null, action, targetType, targetId, metadata ? JSON.stringify(metadata) : null, ip, Date.now());
}
