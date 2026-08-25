import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../api.js';
import { useAuth } from '../auth.jsx';

export default function ChangePasswordPage() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const [form, setForm] = useState({ currentPassword: '', newPassword: '', confirm: '' });
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit(event) {
    event.preventDefault(); setError('');
    if (form.newPassword !== form.confirm) return setError('两次输入的新密码不一致');
    setBusy(true);
    try {
      await api('/auth/change-password', { method: 'POST', body: form });
      await logout();
      navigate('/login', { replace: true });
    } catch (err) { setError(err.message); }
    finally { setBusy(false); }
  }

  const initialChange = Boolean(user?.mustChangePassword);
  return <div className="center-card-page"><form className="dialog-card password-card" onSubmit={submit}><span className="eyebrow">账户安全</span><h1>{initialChange ? '请先修改初始密码' : '修改登录密码'}</h1><p>{initialChange ? '首次登录必须设置新密码。' : '你可以随时更新自己的登录密码。'}新密码至少 10 位，并同时包含字母和数字；修改后需要重新登录。</p>{error && <div className="form-error">{error}</div>}<label>当前密码<input type="password" autoComplete="current-password" value={form.currentPassword} onChange={(e) => setForm({ ...form, currentPassword: e.target.value })} required /></label><label>新密码<input type="password" autoComplete="new-password" value={form.newPassword} onChange={(e) => setForm({ ...form, newPassword: e.target.value })} required /></label><label>确认新密码<input type="password" autoComplete="new-password" value={form.confirm} onChange={(e) => setForm({ ...form, confirm: e.target.value })} required /></label><button className="button primary" disabled={busy}>{busy ? '正在修改…' : '修改密码并重新登录'}</button>{!initialChange && <button type="button" className="button ghost" onClick={() => navigate(-1)}>取消并返回</button>}</form></div>;
}
