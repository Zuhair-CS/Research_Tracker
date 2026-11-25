import { StrictMode, Suspense, lazy } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter, Navigate, Route, Routes } from 'react-router';
import { AuthProvider, RequireAuth } from './auth/AuthContext';
import { Layout } from './components/Layout';
import { LoadingState } from './components/LoadingState';
import { AccountPage } from './pages/AccountPage';
import { AuditLogPage } from './pages/AuditLogPage';
import { ClaimPage } from './pages/ClaimPage';
import { ClaimsPage } from './pages/ClaimsPage';
import { FindResearchPage } from './pages/FindResearchPage';
import { LoginPage } from './pages/LoginPage';
import { NotificationsPage } from './pages/NotificationsPage';
import { OrcidPage } from './pages/OrcidPage';
import { PublicationFormPage } from './pages/PublicationFormPage';
import { PublicationsPage } from './pages/PublicationsPage';
import { SignupPage } from './pages/SignupPage';
import { UsersPage } from './pages/UsersPage';
import './styles.css';

// The dashboard pulls in the charting library; load it only when an admin opens it.
const DashboardPage = lazy(() => import('./pages/DashboardPage').then((m) => ({ default: m.DashboardPage })));

createRoot(document.getElementById('root') as HTMLElement).render(
  <StrictMode>
    <BrowserRouter>
      <AuthProvider>
        <Routes>
          <Route element={<Layout />}>
            <Route path="/login" element={<LoginPage />} />
            <Route path="/signup" element={<SignupPage />} />
            <Route path="/" element={<RequireAuth><PublicationsPage /></RequireAuth>} />
            <Route path="/publications/new" element={<RequireAuth roles={['RESEARCHER']}><PublicationFormPage /></RequireAuth>} />
            <Route path="/publications/:id/edit" element={<RequireAuth roles={['RESEARCHER', 'ADMIN']}><PublicationFormPage /></RequireAuth>} />
            <Route path="/orcid" element={<RequireAuth roles={['RESEARCHER']}><OrcidPage /></RequireAuth>} />
            <Route path="/find" element={<RequireAuth><FindResearchPage /></RequireAuth>} />
            <Route path="/find-researcher" element={<Navigate to="/find" replace />} />
            <Route path="/claims" element={<RequireAuth roles={['ADMIN', 'RESEARCHER']}><ClaimsPage /></RequireAuth>} />
            <Route path="/claims/:id" element={<RequireAuth roles={['ADMIN', 'RESEARCHER']}><ClaimPage /></RequireAuth>} />
            <Route path="/notifications" element={<RequireAuth><NotificationsPage /></RequireAuth>} />
            <Route path="/account" element={<RequireAuth><AccountPage /></RequireAuth>} />
            <Route
              path="/admin"
              element={
                <RequireAuth roles={['ADMIN']}>
                  <Suspense fallback={<LoadingState />}>
                    <DashboardPage />
                  </Suspense>
                </RequireAuth>
              }
            />
            <Route path="/admin/users" element={<RequireAuth roles={['ADMIN']}><UsersPage /></RequireAuth>} />
            <Route path="/admin/audit" element={<RequireAuth roles={['ADMIN']}><AuditLogPage /></RequireAuth>} />
            <Route
              path="*"
              element={
                <div className="card empty-card">
                  <h1>Page not found</h1>
                  <p className="muted">The page you requested does not exist.</p>
                </div>
              }
            />
          </Route>
        </Routes>
      </AuthProvider>
    </BrowserRouter>
  </StrictMode>,
);
