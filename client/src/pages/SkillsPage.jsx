import React, { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api, formatTime } from '../api.js';
import { EmptyState, LoadingPage, PageHeader, useAsyncData } from '../components.jsx';
import { useAuth } from '../auth.jsx';

export default function SkillsPage() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [search, setSearch] = useState('');
  const [showCreate, setShowCreate] = useState(false);
  const [slug, setSlug] = useState('');
  const [error, setError] = useState('');
  const { data, loading, reload } = useAsyncData(() => api(`/skills?search=${encodeURIComponent(search)}`), [search]);

  async function create(event) {
    event.preventDefault(); setError('');
    try {
      const result = await api('/skills', { method: 'POST', body: { slug } });
      navigate(`/drafts/${result.draftId}`);
    } catch (err) { setError(err.message); }
  }

  return <div className="page"><PageHeader eyebrow="SKILLS" title="Skill 管理" description="查看当前发布状态，创建草稿并追溯每一次业务规则调整。" actions={user.role === 'EDITOR' && <button className="button primary" onClick={() => setShowCreate(true)}>＋ 新建 Skill</button>} /><div className="toolbar"><div className="search-box">⌕<input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="搜索 Skill 名称" /></div><a className="button secondary" href="/api/exports/current.zip">⇩ 下载当前发布包</a></div>{loading ? <LoadingPage /> : data?.skills.length ? <div className="skill-grid">{data.skills.map((skill) => <Link to={`/skills/${skill.slug}`} className="skill-card" key={skill.id}><div className="skill-card-top"><span className="skill-glyph large">{skill.slug.slice(0, 1).toUpperCase()}</span><div className="skill-flags">{skill.pendingCount > 0 && <span className="pending-dot">{skill.pendingCount} 待审</span>}{skill.myDraftId && <span className="draft-dot">有草稿</span>}</div></div><h2>{skill.slug}</h2><p>{skill.description || '尚未发布，等待首个版本通过审核。'}</p><div className="skill-meta"><span>{skill.currentVersionNo ? `当前 v${skill.currentVersionNo}` : '未发布'}</span><span>{skill.publishedAt ? formatTime(skill.publishedAt) : formatTime(skill.createdAt)}</span></div></Link>)}</div> : <EmptyState title="没有找到 Skill" description={search ? '尝试更换搜索关键词。' : '由编辑者创建第一个 Skill。'} />}{showCreate && <div className="modal-backdrop" onMouseDown={() => setShowCreate(false)}><form className="dialog-card" onMouseDown={(e) => e.stopPropagation()} onSubmit={create}><span className="eyebrow">NEW SKILL</span><h2>创建 Skill</h2><p>名称发布后不可修改，只能使用小写字母、数字和连字符。</p>{error && <div className="form-error">{error}</div>}<label>Skill 名称<input autoFocus value={slug} onChange={(e) => setSlug(e.target.value.toLowerCase())} placeholder="例如 customer-risk-review" required /></label><div className="dialog-actions"><button type="button" className="button ghost" onClick={() => setShowCreate(false)}>取消</button><button className="button primary">创建并编辑</button></div></form></div>}</div>;
}
