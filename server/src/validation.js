import crypto from 'node:crypto';
import yaml from 'js-yaml';
import {
  MAX_FILE_BYTES,
  MAX_FILES_PER_SKILL,
  MAX_PACKAGE_BYTES,
  SLUG_PATTERN,
} from './constants.js';

export class ValidationError extends Error {
  constructor(message, details = []) {
    super(message);
    this.name = 'ValidationError';
    this.details = details;
  }
}

export function computeContentHash(content) {
  return crypto.createHash('sha256').update(content, 'utf8').digest('hex');
}

export function computeSnapshotHash(files) {
  const hash = crypto.createHash('sha256');
  for (const file of [...files].sort((a, b) => a.path.localeCompare(b.path))) {
    hash.update(file.path).update('\0').update(file.content).update('\0');
  }
  return hash.digest('hex');
}

export function validateSlug(slug) {
  if (!SLUG_PATTERN.test(String(slug || '')) || String(slug).length > 80) {
    throw new ValidationError('Skill 名称只能包含小写字母、数字和连字符，且不能超过 80 个字符');
  }
}

export function validateFiles(files, slug, { strict = false } = {}) {
  const errors = [];
  if (!Array.isArray(files)) throw new ValidationError('文件列表格式不正确');
  if (files.length > MAX_FILES_PER_SKILL) errors.push(`单个 Skill 最多允许 ${MAX_FILES_PER_SKILL} 个文件`);
  const seen = new Set();
  let total = 0;
  for (const file of files) {
    const relativePath = String(file?.path || '').replaceAll('\\', '/');
    const content = typeof file?.content === 'string' ? file.content : '';
    if (!isSafeMarkdownPath(relativePath)) errors.push(`非法 Markdown 路径：${relativePath || '(空)'}`);
    if (seen.has(relativePath.toLowerCase())) errors.push(`文件路径重复：${relativePath}`);
    seen.add(relativePath.toLowerCase());
    const size = Buffer.byteLength(content, 'utf8');
    total += size;
    if (size > MAX_FILE_BYTES) errors.push(`文件超过 1 MiB：${relativePath}`);
    if (content.includes('\0')) errors.push(`文件包含非法空字符：${relativePath}`);
  }
  if (total > MAX_PACKAGE_BYTES) errors.push('Skill 文件总大小不能超过 5 MiB');
  if (strict) {
    const root = files.find((file) => file.path === 'SKILL.md');
    if (!root) errors.push('必须保留根目录 SKILL.md');
    else errors.push(...validateFrontmatter(root.content, slug));
  }
  if (errors.length) throw new ValidationError('Skill 内容校验失败', errors);
}

export function isSafeMarkdownPath(relativePath) {
  if (!relativePath || relativePath.startsWith('/') || relativePath.endsWith('/') || !relativePath.toLowerCase().endsWith('.md')) return false;
  const parts = relativePath.split('/');
  return parts.every((part) => part && part !== '.' && part !== '..' && !part.startsWith('.') && !/[\0<>:"|?*]/.test(part));
}

export function validateFrontmatter(content, slug) {
  const errors = [];
  const match = String(content || '').match(/^---\s*\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/);
  if (!match) return ['SKILL.md 必须以合法 YAML frontmatter 开头和结束'];
  try {
    const data = yaml.load(match[1]);
    if (!data || typeof data !== 'object') return ['SKILL.md frontmatter 必须是对象'];
    if (data.name !== slug) errors.push(`frontmatter.name 必须与 Skill 名称一致：${slug}`);
    if (typeof data.description !== 'string' || !data.description.trim()) errors.push('frontmatter.description 不能为空');
    if (Object.hasOwn(data, 'tool-calls')) {
      if (typeof data['tool-calls'] !== 'string' || !data['tool-calls'].trim()) errors.push('frontmatter.tool-calls 必须是空格分隔的工具名字符串');
      else if (!data['tool-calls'].split(/\s+/).every((name) => /^[A-Za-z_][A-Za-z0-9_-]*$/.test(name))) errors.push('frontmatter.tool-calls 中包含非法工具名');
    }
  } catch (error) {
    errors.push(`SKILL.md frontmatter YAML 无法解析：${error.message}`);
  }
  return errors;
}
