import React, { useState } from 'react';
import { api, formatTime, roleLabel } from '../api.js';
import { LoadingPage, PageHeader, useAsyncData } from '../components.jsx';
import { useAuth } from '../auth.jsx';

export default function UsersPage() {
  const { user: currentUser } = useAuth();
  const { data, loading, error, reload } = useAsyncData(async () => {
    const [usersData, requestsData] = await Promise.all([
      api('/admin/users'),
      api('/admin/password-reset-requests'),
    ]);
    return { users: usersData.users, requests: requestsData.requests };
  }, []);
  const [showCreate, setShowCreate] = useState(false);
  const [form, setForm] = useState({ username: '', displayName: '', role: 'EDITOR', temporaryPassword: '' });
  const [actionError, setActionError] = useState('');
  if (loading) return <LoadingPage />;
  const users = data?.users || [];
  const requests = data?.requests || [];

  async function create(event) {
    event.preventDefault(); setActionError('');
    try {
      await api('/admin/users', { method: 'POST', body: form });
      setShowCreate(false);
      setForm({ username: '', displayName: '', role: 'EDITOR', temporaryPassword: '' });
      reload();
    } catch (err) { setActionError(err.message); }
  }

  async function update(target, changes) {
    setActionError('');
    try {
      await api(`/admin/users/${target.id}`, { method: 'PATCH', body: { role: target.role, status: target.status, ...changes } });
      reload();
    } catch (err) { setActionError(err.message); }
  }

  async function reset(target) {
    setActionError('');
    const password = window.prompt(`为 ${target.displayName} 设置临时密码（至少 10 位，包含字母和数字）`);
    if (!password) return;
    try {
      await api(`/admin/users/${target.id}/reset-password`, { method: 'POST', body: { temporaryPassword: password } });
      window.alert('密码已重置，请通过企业内部渠道告知用户。该用户下次登录必须修改密码。');
      reload();
    } catch (err) { setActionError(err.message); }
  }

  return <div className="page">
    <PageHeader eyebrow="ACCESS CONTROL" title="用户管理" description="账号采用单一角色隔离。停用账号后，其现有会话立即失效。" actions={<button className="button primary" onClick={() => setShowCreate(true)}>＋ 创建账号</button>} />
    {(error || actionError) && <div className="form-error">{error || actionError}</div>}
    {requests.length > 0 && <section className="panel table-panel reset-request-panel"><div className="panel-heading"><div><h2>密码重置申请</h2><p>{requests.length} 个申请等待处理；设置临时密码后申请自动完成。</p></div></div><table><thead><tr><th>申请用户</th><th>用户名</th><th>角色</th><th>申请时间</th><th>操作</th></tr></thead><tbody>{requests.map((request) => <tr key={request.id}><td><strong>{request.displayName}</strong></td><td>{request.username}</td><td>{roleLabel[request.role]}</td><td>{formatTime(request.requestedAt)}</td><td><button className="button small primary" onClick={() => reset({ id: request.userId, displayName: request.displayName })}>设置临时密码</button></td></tr>)}</tbody></table></section>}
    <section className="panel table-panel"><table><thead><tr><th>用户</th><th>用户名</th><th>角色</th><th>状态</th><th>创建时间</th><th>操作</th></tr></thead><tbody>{users.map((user) => <tr key={user.id}><td><div className="table-user"><span className="avatar">{user.displayName.slice(0, 1)}</span><div><strong>{user.displayName}</strong>{user.mustChangePassword && <small>待修改初始密码</small>}</div></div></td><td>{user.username}</td><td><select value={user.role} disabled={user.id === currentUser.id} onChange={(event) => update(user, { role: event.target.value })}><option value="ADMIN">管理员</option><option value="EDITOR">编辑者</option><option value="REVIEWER">审核者</option></select></td><td><button className={`toggle ${user.status === 'ACTIVE' ? 'on' : ''}`} disabled={user.id === currentUser.id} onClick={() => update(user, { status: user.status === 'ACTIVE' ? 'DISABLED' : 'ACTIVE' })}><span />{user.status === 'ACTIVE' ? '启用' : '停用'}</button></td><td>{formatTime(user.createdAt)}</td><td><button className="text-button" onClick={() => reset(user)}>重置密码</button></td></tr>)}</tbody></table></section>
    {showCreate && <div className="modal-backdrop" onMouseDown={() => setShowCreate(false)}><form className="dialog-card" onMouseDown={(event) => event.stopPropagation()} onSubmit={create}><span className="eyebrow">NEW ACCOUNT</span><h2>创建平台账号</h2><p>用户首次登录后必须修改临时密码。</p>{actionError && <div className="form-error">{actionError}</div>}<div className="form-grid"><label>用户名<input value={form.username} onChange={(event) => setForm({ ...form, username: event.target.value })} required /></label><label>姓名<input value={form.displayName} onChange={(event) => setForm({ ...form, displayName: event.target.value })} required /></label></div><label>角色<select value={form.role} onChange={(event) => setForm({ ...form, role: event.target.value })}>{Object.entries(roleLabel).map(([value, label]) => <option value={value} key={value}>{label}</option>)}</select></label><label>临时密码<input type="password" value={form.temporaryPassword} onChange={(event) => setForm({ ...form, temporaryPassword: event.target.value })} placeholder="至少 10 位，包含字母和数字" required /></label><div className="dialog-actions"><button type="button" className="button ghost" onClick={() => setShowCreate(false)}>取消</button><button className="button primary">创建账号</button></div></form></div>}
  </div>;
}
