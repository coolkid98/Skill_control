import React, { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, formatReleaseDate, formatTime, isFridayReleaseDate } from '../api.js';
import { EmptyState, LoadingPage, PageHeader, useAsyncData } from '../components.jsx';
import { useAuth } from '../auth.jsx';

export default function ReleasesPage() {
  const { user } = useAuth();
  const [selected, setSelected] = useState('');
  const [editing, setEditing] = useState(null);
  const [requesting, setRequesting] = useState(null);
  const [releaseTime, setReleaseTime] = useState('');
  const [reason, setReason] = useState('');
  const [actionError, setActionError] = useState('');
  const [busy, setBusy] = useState(false);
  const { data, loading, error, reload } = useAsyncData(async () => {
    const releases = await api('/releases');
    if (user.role === 'ADMIN') {
      const pending = await api('/admin/release-time-change-requests');
      return { groups: releases.groups, changeRequests: pending.requests };
    }
    const mine = await api('/release-time-change-requests/mine');
    return { groups: releases.groups, changeRequests: mine.requests };
  }, [user.role]);
  const groups = useMemo(() => selected
    ? (data?.groups || []).filter((group) => group.releaseTime === selected)
    : (data?.groups || []), [data, selected]);
  const pendingByVersion = useMemo(() => new Map((data?.changeRequests || [])
    .filter((request) => request.status === 'PENDING')
    .map((request) => [request.versionId, request])), [data]);

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

  function openRequest(version) {
    setRequesting(version);
    setReleaseTime(''); setReason(''); setActionError('');
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

  async function submitRequest(event) {
    event.preventDefault();
    if (!isFridayReleaseDate(releaseTime)) return setActionError('新投产日期只能选择星期五');
    if (reason.trim().length < 2) return setActionError('请填写至少 2 个字符的改期原因');
    setBusy(true); setActionError('');
    try {
      await api(`/versions/${requesting.id}/release-time-change-requests`, { method: 'POST', body: { releaseTime, reason } });
      setRequesting(null); await reload();
    } catch (err) { setActionError(err.message); }
    finally { setBusy(false); }
  }

  async function reviewRequest(request, decision) {
    let comment = '';
    if (decision === 'REJECT') {
      comment = window.prompt(`请输入驳回 ${request.slug} v${request.versionNo} 改期申请的原因`) || '';
      if (comment.trim().length < 2) return setActionError('驳回时必须填写至少 2 个字符的原因');
    } else if (!window.confirm(`确认将 ${request.slug} v${request.versionNo} 的投产日期调整为 ${formatReleaseDate(request.requestedReleaseTime)}？`)) return;
    setBusy(true); setActionError('');
    try {
      await api(`/admin/release-time-change-requests/${request.id}/review`, { method: 'POST', body: { decision, comment } });
      setSelected(''); await reload();
    } catch (err) {
      setActionError(err.message);
      if (err.data?.code === 'STALE_RELEASE_TIME_CHANGE') await reload();
    }
    finally { setBusy(false); }
  }

  return <div className="page release-page">
    <PageHeader eyebrow="RELEASE MANAGEMENT" title="投产管理" description="按照投产日期分区管理已审批版本；非管理员提交改期申请，管理员审批通过后日期才会变更。" />
    {(error || (!editing && !requesting && actionError)) && <div className="form-error">{error || actionError}</div>}
    {user.role === 'ADMIN' && data?.changeRequests.length > 0 && <section className="panel table-panel release-request-panel"><div className="panel-heading"><div><h2>投产日期变更申请</h2><p>{data.changeRequests.length} 个申请等待管理员审批</p></div></div><table><thead><tr><th>Skill / 版本</th><th>申请人</th><th>日期变化</th><th>改期原因</th><th>申请时间</th><th>操作</th></tr></thead><tbody>{data.changeRequests.map((request) => <tr key={request.id}><td><strong>{request.slug}</strong><small>v{request.versionNo}</small></td><td>{request.requesterName}</td><td><strong>{formatReleaseDate(request.previousReleaseTime)}</strong><small>→ {formatReleaseDate(request.requestedReleaseTime)}</small></td><td className="summary-cell">{request.reason}</td><td>{formatTime(request.createdAt)}</td><td><div className="inline-actions"><button className="button small reject" disabled={busy} onClick={() => reviewRequest(request, 'REJECT')}>驳回</button><button className="button small approve" disabled={busy} onClick={() => reviewRequest(request, 'APPROVE')}>批准</button></div></td></tr>)}</tbody></table></section>}
    {user.role !== 'ADMIN' && data?.changeRequests.length > 0 && <section className="panel table-panel release-request-panel"><div className="panel-heading"><div><h2>我的改期申请</h2><p>查看管理员审批进度和意见</p></div></div><table><thead><tr><th>Skill / 版本</th><th>日期变化</th><th>申请原因</th><th>状态</th><th>审批意见</th><th>申请时间</th></tr></thead><tbody>{data.changeRequests.slice(0, 20).map((request) => <tr key={request.id}><td><strong>{request.slug}</strong><small>v{request.versionNo}</small></td><td><strong>{formatReleaseDate(request.previousReleaseTime)}</strong><small>→ {formatReleaseDate(request.requestedReleaseTime)}</small></td><td className="summary-cell">{request.reason}</td><td><span className={`status status-${request.status === 'PENDING' ? 'submitted' : request.status.toLowerCase()}`}>{request.status === 'PENDING' ? '待审批' : request.status === 'APPROVED' ? '已批准' : '已驳回'}</span></td><td className="summary-cell">{request.reviewComment || '—'}</td><td>{formatTime(request.createdAt)}</td></tr>)}</tbody></table></section>}
    {data?.groups.length ? <>
      <div className="toolbar release-toolbar"><label>投产日期筛选<select value={selected} onChange={(event) => setSelected(event.target.value)}><option value="">全部投产日期</option>{data.groups.map((group) => <option key={group.releaseTime} value={group.releaseTime}>{formatReleaseDate(group.releaseTime)}（{group.versions.length}）</option>)}</select></label></div>
      <div className="release-groups">{groups.map((group) => <section className="panel release-group" key={group.releaseTime}>
        <div className="panel-heading"><div><span className="release-date-label">投产日期</span><h2>{formatReleaseDate(group.releaseTime)}</h2><p>共 {group.versions.length} 个已审批版本</p></div><div className="header-actions">{user.role === 'ADMIN' && <button className="button secondary" onClick={() => openBatch(group)}>整批调整日期</button>}<a className="button secondary" href={`/api/exports/releases/${group.releaseTime}.zip`}>⇩ 下载该批次</a></div></div>
        <div className="release-version-list">{group.versions.map((version) => {
          const pending = pendingByVersion.get(version.id);
          return <div className={`release-version-row ${user.role === 'ADMIN' ? 'admin-row' : 'request-row'}`} key={version.id}>
            <Link className="skill-glyph" to={`/versions/${version.id}`}>{version.slug.slice(0, 1).toUpperCase()}</Link>
            <div><Link to={`/versions/${version.id}`}><strong>{version.slug} · v{version.versionNo}</strong></Link><p>{version.summary || '无变更说明'}</p></div>
            <span>{version.creatorName || '系统'}</span>
            <time>审批于 {formatTime(version.reviewedAt)}</time>
            {user.role === 'ADMIN' ? <button className="button small secondary" onClick={() => openEdit(version)}>调整日期</button> : pending ? <span className="status status-submitted" title={`${formatReleaseDate(pending.previousReleaseTime)} → ${formatReleaseDate(pending.requestedReleaseTime)}`}>改期待审批</span> : <button className="button small secondary" onClick={() => openRequest(version)}>申请改期</button>}
          </div>;
        })}</div>
      </section>)}</div>
    </> : !error && <EmptyState title="暂无投产批次" description="版本填写投产日期并审批通过后，会按日期显示在这里。" />}
    {editing && <div className="modal-backdrop" onMouseDown={() => setEditing(null)}><form className="dialog-card" onMouseDown={(event) => event.stopPropagation()} onSubmit={saveReleaseTime}><span className="eyebrow">RELEASE DATE</span><h2>{editing.type === 'batch' ? '整批调整投产日期' : '调整投产日期'}</h2><p>{editing.type === 'batch' ? `将 ${formatReleaseDate(editing.releaseTime)} 下的 ${editing.count} 个已批准版本整体移动到新投产日期。` : `${editing.slug} · v${editing.versionNo}，原日期为 ${formatReleaseDate(editing.releaseTime)}。`}此操作只调整投产分区，不修改版本文件。</p>{actionError && <div className="form-error">{actionError}</div>}<label>新投产日期（仅限周五）<input autoFocus type="date" min="1970-01-02" step="7" value={releaseTime} onChange={(event) => { const value = event.target.value; setReleaseTime(value); if (value && !isFridayReleaseDate(value)) setActionError('投产日期只能选择星期五'); else setActionError(''); }} required /></label><div className="dialog-actions"><button type="button" className="button ghost" onClick={() => setEditing(null)}>取消</button><button className="button primary" disabled={busy}>{busy ? '正在保存…' : '确认调整'}</button></div></form></div>}
    {requesting && <div className="modal-backdrop" onMouseDown={() => setRequesting(null)}><form className="dialog-card" onMouseDown={(event) => event.stopPropagation()} onSubmit={submitRequest}><span className="eyebrow">CHANGE REQUEST</span><h2>申请调整投产日期</h2><p>{requesting.slug} · v{requesting.versionNo}，当前日期为 {formatReleaseDate(requesting.releaseTime)}。管理员批准前不会改变现有投产分区。</p>{actionError && <div className="form-error">{actionError}</div>}<label>申请投产日期（仅限周五）<input autoFocus type="date" min="1970-01-02" step="7" value={releaseTime} onChange={(event) => { const value = event.target.value; setReleaseTime(value); if (value && !isFridayReleaseDate(value)) setActionError('新投产日期只能选择星期五'); else setActionError(''); }} required /></label><label>改期原因<textarea value={reason} onChange={(event) => setReason(event.target.value)} maxLength={500} placeholder="说明调整日期的业务原因和影响…" required /></label><div className="dialog-actions"><button type="button" className="button ghost" onClick={() => setRequesting(null)}>取消</button><button className="button primary" disabled={busy}>{busy ? '正在提交…' : '提交管理员审批'}</button></div></form></div>}
  </div>;
}
