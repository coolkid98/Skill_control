export const ROLES = Object.freeze({
  ADMIN: 'ADMIN',
  EDITOR: 'EDITOR',
  REVIEWER: 'REVIEWER',
});

export const USER_STATUSES = Object.freeze({
  ACTIVE: 'ACTIVE',
  DISABLED: 'DISABLED',
});

export const VERSION_STATUSES = Object.freeze({
  DRAFT: 'DRAFT',
  SUBMITTED: 'SUBMITTED',
  APPROVED: 'APPROVED',
  REJECTED: 'REJECTED',
  SUPERSEDED: 'SUPERSEDED',
});

export const CHANGE_TYPES = Object.freeze({
  CREATE: 'CREATE',
  UPDATE: 'UPDATE',
  ROLLBACK: 'ROLLBACK',
});

export const COOKIE_NAME = 'skill_control_session';
export const MAX_FILE_BYTES = 1024 * 1024;
export const MAX_PACKAGE_BYTES = 5 * 1024 * 1024;
export const MAX_FILES_PER_SKILL = 100;
export const SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
