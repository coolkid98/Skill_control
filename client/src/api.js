export class ApiError extends Error {
  constructor(message, status, data) {
    super(message);
    this.status = status;
    this.data = data;
  }
}

export async function api(path, options = {}) {
  const response = await fetch(`/api${path}`, {
    credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json', ...(options.headers || {}) },
    ...options,
    body: options.body && typeof options.body !== 'string' ? JSON.stringify(options.body) : options.body,
  });
  if (response.status === 204) return null;
  const contentType = response.headers.get('content-type') || '';
  const data = contentType.includes('application/json') ? await response.json() : await response.text();
  if (!response.ok) {
    const details = Array.isArray(data?.details) && data.details.length ? `\n${data.details.join('\n')}` : '';
    throw new ApiError(`${data?.error || '请求失败'}${details}`, response.status, data);
  }
  return data;
}

export function formatTime(value) {
  if (!value) return '—';
  return new Intl.DateTimeFormat('zh-CN', {
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit',
  }).format(new Date(value));
}

export function formatReleaseDate(value) {
  if (!value) return '未设置';
  const match = String(value).match(/^(\d{4})-(\d{2})-(\d{2})$/);
  return match ? `${match[1]}年${match[2]}月${match[3]}日` : String(value);
}

export function isFridayReleaseDate(value) {
  const match = String(value || '').match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return false;
  const [, year, month, day] = match.map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year
    && date.getUTCMonth() === month - 1
    && date.getUTCDate() === day
    && date.getUTCDay() === 5;
}

export const statusLabel = {
  DRAFT: '草稿',
  SUBMITTED: '待审核',
  APPROVED: '已批准',
  REJECTED: '已驳回',
  SUPERSEDED: '基线过期',
};

export const roleLabel = {
  ADMIN: '管理员',
  EDITOR: '编辑者',
  REVIEWER: '审核者',
};
