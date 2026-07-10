import React, { useEffect, useState } from 'react';
import { NavLink, Navigate, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { roleLabel, statusLabel } from './api.js';
import { useAuth } from './auth.jsx';

export function ProtectedRoute() {
  const { user, loading } = useAuth();
  const location = useLocation();
  if (loading) return <LoadingPage />;
  if (!user) return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  if (user.mustChangePassword && location.pathname !== '/change-password') return <Navigate to="/change-password" replace />;
  return <Outlet />;
}

export function RoleRoute({ roles }) {
  const { user } = useAuth();
  if (!roles.includes(user?.role)) return <Navigate to="/" replace />;
  return <Outlet />;
}

export function Layout() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);

  async function doLogout() {
    await logout();
    navigate('/login');
  }

  return (
    <div className="app-shell">
      <aside className={`sidebar ${open ? 'open' : ''}`}>
        <div className="brand">
          <span className="brand-mark">S</span>
          <div><strong>Skill Control</strong><small>版本控制中心</small></div>
        </div>
        <nav onClick={() => setOpen(false)}>
          <NavItem to="/" icon="◫" label="工作台" end />
          <NavItem to="/skills" icon="◇" label="Skill 管理" />
          {user.role === 'REVIEWER' && <NavItem to="/reviews" icon="✓" label="审批待办" />}
          {user.role === 'ADMIN' && <NavItem to="/users" icon="♙" label="用户管理" />}
          {user.role === 'ADMIN' && <NavItem to="/audit" icon="≡" label="审计日志" />}
        </nav>
        <div className="sidebar-bottom">
          <a className="nav-download" href="/api/exports/current.zip">⇩ 导出当前发布包</a>
          <div className="user-card">
            <span className="avatar">{user.displayName.slice(0, 1)}</span>
            <div><strong>{user.displayName}</strong><small>{roleLabel[user.role]}</small></div>
            <button className="icon-button" onClick={doLogout} title="退出登录">↪</button>
          </div>
        </div>
      </aside>
      <div className="main-area">
        <header className="mobile-header">
          <button className="icon-button" onClick={() => setOpen(!open)}>☰</button>
          <strong>Skill Control</strong>
        </header>
        <main><Outlet /></main>
      </div>
      {open && <button className="sidebar-mask" aria-label="关闭菜单" onClick={() => setOpen(false)} />}
    </div>
  );
}

function NavItem({ to, icon, label, end }) {
  return <NavLink to={to} end={end} className={({ isActive }) => isActive ? 'nav-item active' : 'nav-item'}><span>{icon}</span>{label}</NavLink>;
}

export function PageHeader({ eyebrow, title, description, actions }) {
  return <header className="page-header"><div><span className="eyebrow">{eyebrow}</span><h1>{title}</h1>{description && <p>{description}</p>}</div>{actions && <div className="header-actions">{actions}</div>}</header>;
}

export function StatusBadge({ status }) {
  return <span className={`status status-${status?.toLowerCase()}`}>{statusLabel[status] || status || '—'}</span>;
}

export function LoadingPage({ label = '正在加载…' }) {
  return <div className="loading-page"><span className="spinner" />{label}</div>;
}

export function EmptyState({ title, description, action }) {
  return <div className="empty-state"><div className="empty-icon">◇</div><h3>{title}</h3><p>{description}</p>{action}</div>;
}

export function Notice({ type = 'info', children }) {
  return <div className={`notice notice-${type}`}>{children}</div>;
}

export function useAsyncData(loader, deps = []) {
  const [state, setState] = useState({ loading: true, data: null, error: '' });
  async function load() {
    setState((old) => ({ ...old, loading: true, error: '' }));
    try { setState({ loading: false, data: await loader(), error: '' }); }
    catch (error) { setState({ loading: false, data: null, error: error.message }); }
  }
  useEffect(() => { load(); }, deps);
  return { ...state, reload: load };
}
