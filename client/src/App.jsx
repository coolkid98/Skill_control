import React, { lazy, Suspense } from 'react';
import { Navigate, Route, Routes } from 'react-router-dom';
import { AuthProvider } from './auth.jsx';
import { Layout, LoadingPage, ProtectedRoute, RoleRoute } from './components.jsx';

const LoginPage = lazy(() => import('./pages/LoginPage.jsx'));
const ChangePasswordPage = lazy(() => import('./pages/ChangePasswordPage.jsx'));
const DashboardPage = lazy(() => import('./pages/DashboardPage.jsx'));
const SkillsPage = lazy(() => import('./pages/SkillsPage.jsx'));
const SkillDetailPage = lazy(() => import('./pages/SkillDetailPage.jsx'));
const EditorPage = lazy(() => import('./pages/EditorPage.jsx'));
const ReviewsPage = lazy(() => import('./pages/ReviewsPage.jsx'));
const ReviewPage = lazy(() => import('./pages/ReviewPage.jsx'));
const UsersPage = lazy(() => import('./pages/UsersPage.jsx'));
const AuditPage = lazy(() => import('./pages/AuditPage.jsx'));

export default function App() {
  return (
    <AuthProvider>
      <Suspense fallback={<LoadingPage />}><Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route element={<ProtectedRoute />}>
          <Route path="/change-password" element={<ChangePasswordPage />} />
          <Route element={<Layout />}>
            <Route index element={<DashboardPage />} />
            <Route path="skills" element={<SkillsPage />} />
            <Route path="skills/:slug" element={<SkillDetailPage />} />
            <Route element={<RoleRoute roles={['EDITOR']} />}>
              <Route path="drafts/:id" element={<EditorPage />} />
            </Route>
            <Route path="versions/:id" element={<ReviewPage />} />
            <Route element={<RoleRoute roles={['REVIEWER']} />}>
              <Route path="reviews" element={<ReviewsPage />} />
            </Route>
            <Route element={<RoleRoute roles={['ADMIN']} />}>
              <Route path="users" element={<UsersPage />} />
              <Route path="audit" element={<AuditPage />} />
            </Route>
          </Route>
        </Route>
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes></Suspense>
    </AuthProvider>
  );
}
