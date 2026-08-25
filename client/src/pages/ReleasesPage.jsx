import React, { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, formatReleaseDate, formatTime } from '../api.js';
import { EmptyState, LoadingPage, PageHeader, useAsyncData } from '../components.jsx';

export default function ReleasesPage() {
  const [selected, setSelected] = useState('');
  const { data, loading, error } = useAsyncData(() => api('/releases'), []);
  const groups = useMemo(() => selected
    ? (data?.groups || []).filter((group) => group.releaseTime === selected)
    : (data?.groups || []), [data, selected]);

  if (loading) return <LoadingPage />;

  return <div className="page release-page">
    <PageHeader eyebrow="RELEASE MANAGEMENT" title="投产管理" description="按照投产日期分区查看已审批版本，并为每个投产批次生成独立发布包；同一 Skill 同日多版时导出最新版本。" />
    {error && <div className="form-error">{error}</div>}
    {data?.groups.length ? <>
      <div className="toolbar release-toolbar"><label>投产日期筛选<select value={selected} onChange={(event) => setSelected(event.target.value)}><option value="">全部投产日期</option>{data.groups.map((group) => <option key={group.releaseTime} value={group.releaseTime}>{formatReleaseDate(group.releaseTime)}（{group.versions.length}）</option>)}</select></label></div>
      <div className="release-groups">{groups.map((group) => <section className="panel release-group" key={group.releaseTime}>
        <div className="panel-heading"><div><span className="release-date-label">投产日期</span><h2>{formatReleaseDate(group.releaseTime)}</h2><p>共 {group.versions.length} 个已审批版本</p></div><a className="button secondary" href={`/api/exports/releases/${group.releaseTime}.zip`}>⇩ 下载该批次</a></div>
        <div className="release-version-list">{group.versions.map((version) => <Link className="release-version-row" to={`/versions/${version.id}`} key={version.id}><span className="skill-glyph">{version.slug.slice(0, 1).toUpperCase()}</span><div><strong>{version.slug} · v{version.versionNo}</strong><p>{version.summary || '无变更说明'}</p></div><span>{version.creatorName || '系统'}</span><time>审批于 {formatTime(version.reviewedAt)}</time></Link>)}</div>
      </section>)}</div>
    </> : !error && <EmptyState title="暂无投产批次" description="版本填写投产日期并审批通过后，会按日期显示在这里。" />}
  </div>;
}
