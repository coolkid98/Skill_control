import { describe, expect, it } from 'vitest';
import { formatReleaseDate, formatTime, statusLabel } from './api.js';

describe('展示工具', () => {
  it('提供完整的版本状态中文标签', () => {
    expect(statusLabel).toEqual(expect.objectContaining({
      DRAFT: '草稿', SUBMITTED: '待审核', APPROVED: '已批准', REJECTED: '已驳回', SUPERSEDED: '基线过期',
    }));
  });

  it('空时间显示占位符', () => {
    expect(formatTime(null)).toBe('—');
  });

  it('投产日期按中文日期展示且不发生时区偏移', () => {
    expect(formatReleaseDate('2026-09-26')).toBe('2026年09月26日');
    expect(formatReleaseDate(null)).toBe('未设置');
  });
});
