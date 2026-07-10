import React from 'react';
import { Link } from 'react-router-dom';
import { api, formatTime } from '../api.js';
import { EmptyState, LoadingPage, PageHeader, StatusBadge, useAsyncData } from '../components.jsx';

export default function ReviewsPage() {
  const { data, loading, error } = useAsyncData(() => api('/versions?status=SUBMITTED'), []);
  if (loading) return <LoadingPage />;
  return <div className="page"><PageHeader eyebrow="REVIEW QUEUE" title="审批待办" description="逐文件核对变更。批准后，新版本将立即进入可导出的发布包。" />{error && <div className="form-error">{error}</div>}{data?.versions.length ? <section className="panel table-panel"><table><thead><tr><th>Skill / 版本</th><th>变更说明</th><th>提交人</th><th>提交时间</th><th>状态</th><th /></tr></thead><tbody>{data.versions.map((version) => <tr key={version.id}><td><strong>{version.slug}</strong><small>v{version.versionNo}</small></td><td className="summary-cell">{version.summary}</td><td>{version.creatorName}</td><td>{formatTime(version.submittedAt)}</td><td><StatusBadge status={version.status} /></td><td><Link className="button small secondary" to={`/versions/${version.id}`}>开始审核</Link></td></tr>)}</tbody></table></section> : <EmptyState title="没有待审核版本" description="新的提交会自动出现在这里。" />}</div>;
}
