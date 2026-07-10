import React, { useState } from 'react';
import { Navigate, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../auth.jsx';

export default function LoginPage() {
  const { user, loading, login } = useAuth();
  const [form, setForm] = useState({ username: '', password: '' });
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const navigate = useNavigate();
  const location = useLocation();

  if (!loading && user) return <Navigate to={user.mustChangePassword ? '/change-password' : '/'} replace />;

  async function submit(event) {
    event.preventDefault();
    setSubmitting(true); setError('');
    try {
      const loggedIn = await login(form.username, form.password);
      navigate(loggedIn.mustChangePassword ? '/change-password' : (location.state?.from || '/'), { replace: true });
    } catch (err) { setError(err.message); }
    finally { setSubmitting(false); }
  }

  return (
    <div className="login-page">
      <div className="login-visual">
        <div className="login-grid" />
        <div className="login-copy">
          <span className="brand-mark large">S</span>
          <p className="eyebrow">SKILL GOVERNANCE</p>
          <h1>让每一次业务调整<br />都有迹可循</h1>
          <p>集中编辑、版本追溯、隔离审批与可信发布，守住智能体能力变更的最后一道关口。</p>
          <div className="visual-points"><span>不可变快照</span><span>逐文件差异</span><span>审计留痕</span></div>
        </div>
      </div>
      <div className="login-panel">
        <form className="login-form" onSubmit={submit}>
          <div><span className="eyebrow">欢迎回来</span><h2>登录 Skill 控制台</h2><p>使用管理员分配的账号继续</p></div>
          {error && <div className="form-error">{error}</div>}
          <label>用户名<input autoFocus autoComplete="username" value={form.username} onChange={(e) => setForm({ ...form, username: e.target.value })} placeholder="请输入用户名" required /></label>
          <label>密码<input type="password" autoComplete="current-password" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} placeholder="请输入密码" required /></label>
          <button className="button primary large-button" disabled={submitting}>{submitting ? '正在登录…' : '登录控制台'}</button>
          <small className="login-hint">首次登录后，系统会要求修改初始密码。</small>
        </form>
      </div>
    </div>
  );
}
