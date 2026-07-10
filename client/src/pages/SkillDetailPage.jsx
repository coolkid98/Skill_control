import React, { useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { api, formatTime } from '../api.js';
import { EmptyState, LoadingPage, Notice, PageHeader, StatusBadge, useAsyncData } from '../components.jsx';
import { useAuth } from '../auth.jsx';

export default function SkillDetailPage() {
  const { slug } = useParams();
  const { user } = useAuth();
  const navigate = useNavigate();
  const [selectedFile, setSelectedFile] = useState('SKILL.md');
  const [actionError, setActionError] = useState('');
  const { data, loading, error } = useAsyncData(() => api(`/skills/${slug}`), [slug]);
  if (loading) return <LoadingPage />;
  if (error) return <div className="form-error page-error">{error}</div>;
  const ownDraft = data.versions.find((version) => version.status === 'DRAFT');
  const currentContent = data.currentFiles.find((file) => file.path === selectedFile)?.content || '';

  async function createDraft(sourceVersionId, rollback = false) {
    setActionError('');
    try {
      const result = await api(`/skills/${slug}/drafts`, { method: 'POST', body: { sourceVersionId, rollback } });
      navigate(`/drafts/${result.draftId}`);
    } catch (err) {
      if (err.data?.draftId) navigate(`/drafts/${err.data.draftId}`);
      else setActionError(err.message);
    }
  }

  return <div className="page"><div className="crumbs"><Link to="/skills">Skill 管理</Link><span>/</span><span>{slug}</span></div><PageHeader eyebrow="SKILL DETAIL" title={slug} description={data.skill.description || '尚未发布首个版本'} actions={<>{data.skill.currentPublishedVersionId && <a className="button secondary" href={`/api/versions/${data.skill.currentPublishedVersionId}/export.zip`}>下载 v{data.skill.currentVersionNo}</a>}{user.role === 'EDITOR' && (ownDraft ? <Link className="button primary" to={`/drafts/${ownDraft.id}`}>继续编辑草稿</Link> : <button className="button primary" onClick={() => createDraft()}>创建修改草稿</button>)}</>} />{actionError && <div className="form-error">{actionError}</div>}{ownDraft?.stale && <Notice type="warning">你的草稿基于旧发布版，无法直接提交。请丢弃后从最新版本重新创建。</Notice>}<div className="detail-grid"><section className="panel published-panel"><div className="panel-heading"><div><h2>当前发布内容</h2><p>{data.skill.currentVersionNo ? `v${data.skill.currentVersionNo} · ${formatTime(data.skill.publishedAt)}` : '尚无已批准版本'}</p></div></div>{data.currentFiles.length ? <div className="file-preview"><aside>{data.currentFiles.map((file) => <button key={file.path} className={selectedFile === file.path ? 'active' : ''} onClick={() => setSelectedFile(file.path)}>{file.path}</button>)}</aside><article className="markdown-body"><ReactMarkdown remarkPlugins={[remarkGfm]}>{currentContent}</ReactMarkdown></article></div> : <EmptyState title="等待首个版本" description="编辑者提交并经审核者批准后，发布内容会显示在这里。" />}</section><section className="panel history-panel"><div className="panel-heading"><div><h2>版本历史</h2><p>提交快照永久保留</p></div></div>{data.versions.length ? <div className="version-list">{data.versions.map((version) => <div className="version-row" key={version.id}><div className="version-line"><span className="version-node" /></div><div className="version-content"><div><Link to={version.status === 'DRAFT' ? `/drafts/${version.id}` : `/versions/${version.id}`}><strong>{version.versionNo ? `v${version.versionNo}` : '草稿'}</strong></Link><StatusBadge status={version.status} /></div><p>{version.summary || '尚未填写变更说明'}</p><small>{version.creatorName || '系统'} · {formatTime(version.submittedAt || version.createdAt)}</small>{version.reviewComment && <blockquote>{version.reviewComment}</blockquote>}<div className="version-actions">{version.status === 'APPROVED' && <a href={`/api/versions/${version.id}/export.zip`}>下载</a>}{user.role === 'EDITOR' && version.status === 'APPROVED' && version.id !== data.skill.currentPublishedVersionId && !ownDraft && <button onClick={() => createDraft(version.id, true)}>回滚至此版本</button>}{user.role === 'EDITOR' && ['REJECTED', 'SUPERSEDED'].includes(version.status) && !ownDraft && <button onClick={() => createDraft(version.id, false)}>复制为新草稿</button>}</div></div></div>)}</div> : <EmptyState title="暂无版本" description="创建并提交首个草稿后会显示历史。" />}</section></div></div>;
}
