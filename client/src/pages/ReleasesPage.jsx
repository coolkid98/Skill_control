import React, { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, formatReleaseDate, formatTime, isFridayReleaseDate } from '../api.js';
import { EmptyState, LoadingPage, PageHeader, useAsyncData } from '../components.jsx';
import { useAuth } from '../auth.jsx';

export default function ReleasesPage() {
  const { user } = useAuth();
  const [selected, setSelected] = useState('');
  const [editing, setEditing] = useState(null);
  const [releaseTime, setReleaseTime] = useState('');
  const [actionError, setActionError] = useState('');
  const [busy, setBusy] = useState(false);
  const { data, loading, error, reload } = useAsyncData(() => api('/releases'), []);
  const groups = useMemo(() => selected
    ? (data?.groups || []).filter((group) => group.releaseTime === selected)
    : (data?.groups || []), [data, selected]);

  if (loading) return <LoadingPage />;

  function openEdit(version) {
    setEditing({ type: 'version', ...version });
    setReleaseTime(version.releaseTime || '');
    setActionError('');
  }

  function openBatch(group) {
    setEditing({ type: 'batch', releaseTime: group.releaseTime, count: group.versions.length });
    setReleaseTime(group.releaseTime);
    setActionError('');
  }

  async function saveReleaseTime(event) {
    event.preventDefault();
    if (!isFridayReleaseDate(releaseTime)) return setActionError('投产日期只能选择星期五');
    setBusy(true); setActionError('');
    try {
      const path = editing.type === 'batch'
        ? `/admin/releases/${editing.releaseTime}`
        : `/admin/versions/${editing.id}/release-time`;
      await api(path, { method: 'PATCH', body: { releaseTime } });
      setEditing(null); setSelected(''); await reload();
    } catch (err) { setActionError(err.message); }
    finally { setBusy(false); }
  }

  return <div className="page release-page">
    <PageHeader eyebrow="RELEASE MANAGEMENT" title="投产管理" description="按照投产日期分区查看已审批版本，并为每个投产批次生成独立发布包；同一 Skill 同日多版时导出最新版本。" />
    {(error || (!editing && actionError)) && <div className="form-error">{error || actionError}</div>}
    {data?.groups.length ? <>
      <div className="toolbar release-toolbar"><label>投产日期筛选<select value={selected} onChange={(event) => setSelected(event.target.value)}><option value="">全部投产日期</option>{data.groups.map((group) => <option key={group.releaseTime} value={group.releaseTime}>{formatReleaseDate(group.releaseTime)}（{group.versions.length}）</option>)}</select></label></div>
      <div className="release-groups">{groups.map((group) => <section className="panel release-group" key={group.releaseTime}>
        <div className="panel-heading"><div><span className="release-date-label">投产日期</span><h2>{formatReleaseDate(group.releaseTime)}</h2><p>共 {group.versions.length} 个已审批版本</p></div><div className="header-actions">{user.role === 'ADMIN' && <button className="button secondary" onClick={() => openBatch(group)}>整批调整日期</button>}<a className="button secondary" href={`/api/exports/releases/${group.releaseTime}.zip`}>⇩ 下载该批次</a></div></div>
        <div className="release-version-list">{group.versions.map((version) => <div className={`release-version-row ${user.role === 'ADMIN' ? 'admin-row' : ''}`} key={version.id}>
          <Link className="skill-glyph" to={`/versions/${version.id}`}>{version.slug.slice(0, 1).toUpperCase()}</Link>
          <div><Link to={`/versions/${version.id}`}><strong>{version.slug} · v{version.versionNo}</strong></Link><p>{version.summary || '无变更说明'}</p></div>
          <span>{version.creatorName || '系统'}</span>
          <time>审批于 {formatTime(version.reviewedAt)}</time>
          {user.role === 'ADMIN' && <button className="button small secondary" onClick={() => openEdit(version)}>调整日期</button>}
        </div>)}</div>
      </section>)}</div>
    </> : !error && <EmptyState title="暂无投产批次" description="版本填写投产日期并审批通过后，会按日期显示在这里。" />}
    {editing && <div className="modal-backdrop" onMouseDown={() => setEditing(null)}><form className="dialog-card" onMouseDown={(event) => event.stopPropagation()} onSubmit={saveReleaseTime}><span className="eyebrow">RELEASE DATE</span><h2>{editing.type === 'batch' ? '整批调整投产日期' : '调整投产日期'}</h2><p>{editing.type === 'batch' ? `将 ${formatReleaseDate(editing.releaseTime)} 下的 ${editing.count} 个已批准版本整体移动到新投产日期。` : `${editing.slug} · v${editing.versionNo}，原日期为 ${formatReleaseDate(editing.releaseTime)}。`}此操作只调整投产分区，不修改版本文件。</p>{actionError && <div className="form-error">{actionError}</div>}<label>新投产日期（仅限周五）<input autoFocus type="date" min="1970-01-02" step="7" value={releaseTime} onChange={(event) => { const value = event.target.value; setReleaseTime(value); if (value && !isFridayReleaseDate(value)) setActionError('投产日期只能选择星期五'); else setActionError(''); }} required /></label><div className="dialog-actions"><button type="button" className="button ghost" onClick={() => setEditing(null)}>取消</button><button className="button primary" disabled={busy}>{busy ? '正在保存…' : '确认调整'}</button></div></form></div>}
  </div>;
}
