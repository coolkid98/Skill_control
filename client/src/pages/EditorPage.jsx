import React, { useEffect, useMemo, useState } from 'react';
import CodeMirror from '@uiw/react-codemirror';
import { markdown } from '@codemirror/lang-markdown';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { api } from '../api.js';
import { LoadingPage, Notice } from '../components.jsx';

export default function EditorPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [version, setVersion] = useState(null);
  const [files, setFiles] = useState([]);
  const [selected, setSelected] = useState('SKILL.md');
  const [summary, setSummary] = useState('');
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [preview, setPreview] = useState(true);

  useEffect(() => {
    api(`/drafts/${id}`).then(({ version: value }) => {
      setVersion(value); setFiles(value.files); setSummary(value.summary || ''); setSelected(value.files[0]?.path || 'SKILL.md');
    }).catch((err) => setError(err.message));
  }, [id]);
  useEffect(() => {
    const guard = (event) => { if (dirty) { event.preventDefault(); event.returnValue = ''; } };
    window.addEventListener('beforeunload', guard); return () => window.removeEventListener('beforeunload', guard);
  }, [dirty]);
  const current = files.find((file) => file.path === selected);
  const extensions = useMemo(() => [markdown()], []);
  if (!version && !error) return <LoadingPage label="正在打开草稿…" />;
  if (!version) return <div className="form-error page-error">{error}</div>;

  function updateContent(content) {
    setFiles((items) => items.map((file) => file.path === selected ? { ...file, content } : file)); setDirty(true); setMessage('');
  }
  function addFile() {
    const path = window.prompt('请输入 Markdown 相对路径，例如 references/new-rule.md');
    if (!path) return;
    const normalized = path.replaceAll('\\', '/');
    if (!normalized.endsWith('.md') || normalized.includes('..') || normalized.startsWith('/') || files.some((file) => file.path.toLowerCase() === normalized.toLowerCase())) {
      return setError('文件路径不合法或已存在');
    }
    setFiles([...files, { path: normalized, content: `# ${normalized.split('/').pop().replace(/\.md$/i, '')}\n` }].sort((a, b) => a.path.localeCompare(b.path)));
    setSelected(normalized); setDirty(true); setError('');
  }
  function deleteFile() {
    if (selected === 'SKILL.md') return setError('SKILL.md 不能删除');
    if (!window.confirm(`确认删除 ${selected}？`)) return;
    const next = files.filter((file) => file.path !== selected);
    setFiles(next); setSelected(next[0]?.path || 'SKILL.md'); setDirty(true);
  }
  async function save() {
    setBusy(true); setError(''); setMessage('');
    try {
      const data = await api(`/drafts/${id}`, { method: 'PATCH', body: { revision: version.revision, files: files.map(({ path, content }) => ({ path, content })), summary } });
      setVersion(data.version); setFiles(data.version.files); setDirty(false); setMessage('草稿已保存');
      return data.version;
    } catch (err) { setError(err.message); throw err; }
    finally { setBusy(false); }
  }
  async function submit() {
    if (!summary.trim()) return setError('提交审核前请填写变更说明');
    if (!window.confirm('提交后快照不可再修改，确认提交审核？')) return;
    setBusy(true); setError('');
    try {
      const saved = await save();
      const data = await api(`/drafts/${id}/submit`, { method: 'POST', body: { revision: saved.revision, summary } });
      setDirty(false); navigate(`/versions/${data.version.id}`);
    } catch (err) { setError(err.message); }
    finally { setBusy(false); }
  }
  async function discard() {
    if (!window.confirm('确认丢弃整个草稿？此操作不可恢复。')) return;
    await api(`/drafts/${id}`, { method: 'DELETE' }); setDirty(false); navigate(`/skills/${version.slug}`);
  }

  return <div className="editor-page"><header className="editor-header"><div><Link to={`/skills/${version.slug}`}>← {version.slug}</Link><span className="editor-separator">/</span><strong>{version.changeType === 'ROLLBACK' ? '回滚草稿' : '编辑草稿'}</strong>{dirty && <span className="unsaved">未保存</span>}</div><div className="editor-actions"><button className="button ghost danger-text" onClick={discard}>丢弃</button><button className="button secondary" disabled={busy || !dirty} onClick={save}>{busy ? '处理中…' : '保存草稿'}</button><button className="button primary" disabled={busy} onClick={submit}>提交审核</button></div></header>{version.stale && <Notice type="warning">该草稿基于旧发布版，保存不受影响，但提交前必须从最新版本重新创建草稿。</Notice>}{error && <div className="form-error editor-message">{error}</div>}{message && <div className="form-success editor-message">{message}</div>}<div className="editor-workspace"><aside className="file-tree"><div className="tree-heading"><span>文件</span><button onClick={addFile} title="新增文件">＋</button></div>{files.map((file) => <button key={file.path} className={selected === file.path ? 'active' : ''} onClick={() => setSelected(file.path)}><span>▧</span>{file.path}</button>)}<div className="file-tree-bottom"><button disabled={selected === 'SKILL.md'} onClick={deleteFile}>删除当前文件</button></div></aside><section className="code-pane"><div className="pane-bar"><span>{selected}</span><button onClick={() => setPreview(!preview)}>{preview ? '隐藏预览' : '显示预览'}</button></div><CodeMirror value={current?.content || ''} height="calc(100vh - 225px)" extensions={extensions} onChange={updateContent} basicSetup={{ lineNumbers: true, foldGutter: true }} /></section>{preview && <section className="preview-pane"><div className="pane-bar"><span>Markdown 预览</span></div><article className="markdown-body"><ReactMarkdown remarkPlugins={[remarkGfm]}>{current?.content || ''}</ReactMarkdown></article></section>}</div><footer className="editor-footer"><label>变更说明 <span>提交审核时必填</span><textarea value={summary} onChange={(e) => { setSummary(e.target.value); setDirty(true); }} maxLength={500} placeholder="说明本次修改的业务背景、规则变化和影响范围…" /></label><small>{summary.length}/500</small></footer></div>;
}
