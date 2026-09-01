import React, { useRef, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { api, formatTime } from '../api.js';
import { EmptyState, LoadingPage, PageHeader, useAsyncData } from '../components.jsx';
import { useAuth } from '../auth.jsx';

const MAX_FILE_SIZE = 1024 * 1024;

export default function ToolCatalogPage() {
  const { user } = useAuth();
  const inputRef = useRef(null);
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState('');
  const [message, setMessage] = useState('');
  const { data, loading, error, reload } = useAsyncData(() => api('/tool-catalog'), []);
  const canUpload = data?.canUpload === true && user.username === 'Chent';

  async function upload(event) {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    setActionError(''); setMessage('');
    if (!file.name.toLowerCase().endsWith('.md')) return setActionError('只能上传 .md 文件');
    if (file.size > MAX_FILE_SIZE) return setActionError('Markdown 文件不能超过 1 MiB');
    if (data?.document && !window.confirm(`上传 ${file.name} 将替换当前的 ${data.document.filename}，确认继续吗？`)) return;

    setBusy(true);
    try {
      const content = await file.text();
      if (!content.trim()) throw new Error('Markdown 文件内容不能为空');
      await api('/tool-catalog', { method: 'PUT', body: { filename: file.name, content } });
      await reload();
      setMessage(`已上传 ${file.name}`);
    } catch (uploadError) {
      setActionError(uploadError.message);
    } finally {
      setBusy(false);
    }
  }

  if (loading) return <LoadingPage label="正在加载 Tool 清单…" />;

  return <div className="page tool-catalog-page">
    <input ref={inputRef} className="tool-file-input" type="file" accept=".md,text/markdown" onChange={upload} />
    <PageHeader eyebrow="TOOL CATALOG" title="Tool 清单" description="查看平台当前使用的 Tool 说明文档。" actions={canUpload && <button className="button primary" disabled={busy} onClick={() => inputRef.current?.click()}>{busy ? '正在上传…' : data?.document ? '↑ 替换 MD 文件' : '↑ 上传 MD 文件'}</button>} />
    {(error || actionError) && <div className="form-error">{error || actionError}</div>}
    {message && <div className="form-success">{message}</div>}
    {data?.document ? <section className="panel tool-catalog-panel">
      <div className="panel-heading"><div><h2>{data.document.filename}</h2><p>由 {data.document.uploadedBy} 上传于 {formatTime(data.document.uploadedAt)}</p></div><span className="tool-document-size">{Math.max(1, Math.ceil(data.document.size / 1024))} KiB</span></div>
      <article className="markdown-body tool-catalog-content"><ReactMarkdown remarkPlugins={[remarkGfm]}>{data.document.content}</ReactMarkdown></article>
    </section> : <section className="panel"><EmptyState title="尚未上传 Tool 清单" description={canUpload ? '请选择一个 Markdown 文件作为 Tool 清单，上传后所有登录用户都能查看。' : '用户名为 Chent 的用户上传 Markdown 文件后，内容会显示在这里。'} action={canUpload && <button className="button primary" disabled={busy} onClick={() => inputRef.current?.click()}>上传 MD 文件</button>} /></section>}
  </div>;
}
