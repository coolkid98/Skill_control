import React from 'react';
import { api, formatTime } from '../api.js';
import { LoadingPage, PageHeader, useAsyncData } from '../components.jsx';

const actionLabels = {
  BOOTSTRAP_ADMIN: '初始化管理员', SEED_SKILL: '导入初始 Skill', LOGIN: '登录', LOGOUT: '退出',
  CHANGE_PASSWORD: '修改密码', CREATE_USER: '创建用户', UPDATE_USER: '修改用户', RESET_PASSWORD: '重置密码',
  CREATE_SKILL_DRAFT: '创建 Skill', CREATE_DRAFT: '创建草稿', CREATE_ROLLBACK_DRAFT: '创建回滚草稿',
  SAVE_DRAFT: '保存草稿', DISCARD_DRAFT: '丢弃草稿', SUBMIT_VERSION: '提交版本',
  APPROVE_VERSION: '批准版本', REJECT_VERSION: '驳回版本', SUPERSEDE_STALE_VERSION: '版本基线过期',
  EXPORT_CURRENT_BUNDLE: '导出发布包', EXPORT_SKILL_VERSION: '导出历史版本',
};

export default function AuditPage() {
  const { data, loading, error } = useAsyncData(() => api('/admin/audit-logs?limit=300'), []);
  if (loading) return <LoadingPage />;
  return <div className="page"><PageHeader eyebrow="AUDIT TRAIL" title="审计日志" description="关键操作只追加、不覆盖，用于追踪账号、内容和发布行为。" />{error && <div className="form-error">{error}</div>}<section className="panel table-panel"><table><thead><tr><th>时间</th><th>操作人</th><th>动作</th><th>对象</th><th>详情</th><th>IP</th></tr></thead><tbody>{data?.logs.map((log) => <tr key={log.id}><td>{formatTime(log.createdAt)}</td><td><strong>{log.actorName}</strong></td><td>{actionLabels[log.action] || log.action}</td><td>{log.targetType}<small className="mono">{log.targetId || '—'}</small></td><td className="audit-meta">{log.metadata ? JSON.stringify(log.metadata) : '—'}</td><td className="mono">{log.ip || '—'}</td></tr>)}</tbody></table></section></div>;
}
