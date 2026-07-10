import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const isProduction = process.env.NODE_ENV === 'production';

function positiveNumber(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

export const config = {
  isProduction,
  port: positiveNumber(process.env.PORT, 3000),
  dataDir: process.env.DATA_DIR || path.resolve(__dirname, '../data'),
  seedDir: process.env.SEED_DIR || path.resolve(__dirname, '../seed/skills'),
  jwtSecret: process.env.JWT_SECRET || (isProduction ? '' : 'local-development-secret-change-before-production'),
  sessionTtlHours: positiveNumber(process.env.SESSION_TTL_HOURS, 12),
  cookieSecure: process.env.COOKIE_SECURE === 'true',
  bootstrapAdmin: {
    username: process.env.BOOTSTRAP_ADMIN_USERNAME || (isProduction ? '' : 'admin'),
    password: process.env.BOOTSTRAP_ADMIN_PASSWORD || (isProduction ? '' : 'admin12345'),
    displayName: process.env.BOOTSTRAP_ADMIN_DISPLAY_NAME || '系统管理员',
  },
};

export function assertRuntimeConfig() {
  if (!config.jwtSecret || config.jwtSecret.length < 32 || (config.isProduction && config.jwtSecret.startsWith('replace-'))) {
    throw new Error('JWT_SECRET 必须配置且长度不少于 32 个字符');
  }
}
