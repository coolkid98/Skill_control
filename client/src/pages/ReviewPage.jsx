import React, { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { api, formatTime } from '../api.js';
import { LoadingPage, Notice, PageHeader, StatusBadge, useAsyncData } from '../components.jsx';
import { useAuth } from '../auth.jsx';

export default function ReviewPage() {
  const { id } = useParams();
  const { user } = useAuth();
  const navigate = useNavigate();
  const [comment, setComment] = useState('');
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState('');
  const { data: versionData, loading: versionLoading, error: versionError, reload } = useAsyncData(() => api(`/versions/${id}`), [id]);
  const { data: diffData, loading: diffLoading, error: diffError } = useAsyncData(() => api(`/versions/${id}/diff`), [id]);
  if (versionLoading || diffLoading) return <LoadingPage />;
  const error = versionError || diffError;
  if (error) return <div className="form-error page-error">{error}</div>;
  const version = versionData.version;

  async function review(decision) {
    if (decision === 'REJECT' && comment.trim().length < 2) return setActionError('驳回时必须填写具体原因');
    const prompt = decision === 'APPROVE' ? '批准后将立即成为当前发布版本，确认继续？' : '确认驳回此版本？';
    if (!window.confirm(prompt)) return;
    setBusy(true); setActionError('');
    try {
      await api(`/versions/${id}/review`, { method: 'POST', body: { decision, comment } });
      await reload();
      if (decision === 'APPROVE') navigate(`/skills/${version.slug}`);
    } catch (err) { setActionError(err.message); }
    finally { setBusy(false); }
  }

  return <div className="page review-page"><div className="crumbs"><Link to={user.role === 'REVIEWER' ? '/reviews' : `/skills/${version.slug}`}>← 返回</Link></div><PageHeader eyebrow="VERSION REVIEW" title={`${version.slug} · v${version.versionNo || '草稿'}`} description={version.summary || '暂无变更说明'} actions={<StatusBadge status={version.status} />} /><div className="review-meta"><div><span>提交人</span><strong>{version.creatorName}</strong></div><div><span>提交时间</span><strong>{formatTime(version.submittedAt)}</strong></div><div><span>变更类型</span><strong>{version.changeType === 'ROLLBACK' ? '历史回滚' : version.changeType === 'CREATE' ? '新建 Skill' : '内容更新'}</strong></div><div><span>文件变化</span><strong>{diffData.diff.length} 个文件</strong></div></div>{version.status === 'SUPERSEDED' && <Notice type="warning">该提交基于旧发布版本，已不能批准。编辑者需要从当前版本重新创建草稿。</Notice>}{version.reviewComment && <Notice type={version.status === 'REJECTED' ? 'danger' : 'info'}>审核意见：{version.reviewComment}</Notice>}{actionError && <div className="form-error">{actionError}</div>}<section className="panel diff-panel"><div className="panel-heading"><div><h2>逐文件差异</h2><p>红色为删除，绿色为新增</p></div></div>{diffData.diff.length ? diffData.diff.map((file) => <FileDiff file={file} key={file.path} />) : <div className="empty-diff">该版本与基线内容完全一致</div>}</section>{user.role === 'REVIEWER' && version.status === 'SUBMITTED' && <section className="review-bar"><label><span>审核意见</span><textarea value={comment} onChange={(e) => setComment(e.target.value)} maxLength={1000} placeholder="批准时选填；驳回时必须说明需要修改的内容…" /></label><div><button className="button reject" disabled={busy} onClick={() => review('REJECT')}>驳回修改</button><button className="button approve" disabled={busy || version.createdBy === user.id} title={version.createdBy === user.id ? '不能审核自己的提交' : ''} onClick={() => review('APPROVE')}>批准并发布</button></div></section>}</div>;
}

function FileDiff({ file }) {
  const [open, setOpen] = useState(true);
  return <div className="file-diff"><button className="file-diff-head" onClick={() => setOpen(!open)}><span>{open ? '▾' : '▸'} {file.path}</span><span className={`file-change ${file.status.toLowerCase()}`}>{file.status === 'ADDED' ? '新增' : file.status === 'DELETED' ? '删除' : '修改'}</span></button>{open && <pre>{file.changes.map((change, index) => <span className={`diff-${change.type}`} key={`${index}-${change.type}`}>{change.value.split('\n').map((line, lineIndex, values) => lineIndex === values.length - 1 && line === '' ? null : <span className="diff-line" key={lineIndex}><b>{change.type === 'added' ? '+' : change.type === 'removed' ? '−' : ' '}</b>{line}{'\n'}</span>)}</span>)}</pre>}</div>;
}
