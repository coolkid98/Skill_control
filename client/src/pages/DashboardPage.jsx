import React from 'react';
import { Link } from 'react-router-dom';
import { api, formatTime } from '../api.js';
import { EmptyState, LoadingPage, PageHeader, StatusBadge, useAsyncData } from '../components.jsx';
import { useAuth } from '../auth.jsx';

export default function DashboardPage() {
  const { user } = useAuth();
  const { data, loading, error } = useAsyncData(() => api('/dashboard'), []);
  if (loading) return <LoadingPage />;
  if (error) return <div className="form-error page-error">{error}</div>;
  const cards = [
    ['已发布 Skill', data.stats.skills, '当前可导出的能力包', 'mint'],
    ['待审核版本', data.stats.pending, user.role === 'REVIEWER' ? '等待你的审批' : '全平台待处理', 'amber'],
    ['我的草稿', data.stats.myDrafts, '尚未提交的修改', 'blue'],
    ['历史批准版本', data.stats.approvedVersions, '可追溯与回滚', 'violet'],
  ];
  return <div className="page"><PageHeader eyebrow="OVERVIEW" title={`你好，${user.displayName}`} description="这里是 Skill 版本与审批流程的实时概览。" actions={<a className="button primary" href="/api/exports/current.zip">导出发布包</a>} /><section className="stat-grid">{cards.map(([label, value, hint, color]) => <article className={`stat-card ${color}`} key={label}><span>{label}</span><strong>{value}</strong><small>{hint}</small></article>)}</section><section className="panel"><div className="panel-heading"><div><h2>最近动态</h2><p>最近提交或处理的版本</p></div><Link to="/skills" className="text-link">查看全部 →</Link></div>{data.recent.length ? <div className="activity-list">{data.recent.map((item) => <Link to={`/versions/${item.id}`} className="activity-row" key={item.id}><span className="skill-glyph">{item.slug.slice(0, 1).toUpperCase()}</span><div className="activity-main"><strong>{item.slug} {item.versionNo ? `v${item.versionNo}` : '草稿'}</strong><p>{item.summary || '尚未填写变更说明'}</p></div><StatusBadge status={item.status} /><time>{formatTime(item.reviewedAt || item.submittedAt || item.createdAt)}</time></Link>)}</div> : <EmptyState title="还没有版本动态" description="编辑者提交第一个修改后，记录会显示在这里。" />}</section></div>;
}
