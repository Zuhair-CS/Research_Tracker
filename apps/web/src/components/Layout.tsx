import { NavLink, Outlet, useNavigate } from 'react-router';
import { useAuth } from '../auth/AuthContext';
import { NotificationBell } from './NotificationBell';

export function Layout() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();

  const onLogout = async () => {
    await logout();
    navigate('/login');
  };

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">
          <span className="brand-mark" aria-hidden="true">PB</span>
          <span>Publication Tracker</span>
        </div>
        {user && (
          <nav className="nav" aria-label="Main">
            <NavLink to="/" end>
              Publications
            </NavLink>
            <NavLink to="/find">Find research</NavLink>
            {user.role === 'RESEARCHER' && <NavLink to="/publications/new">Add publication</NavLink>}
            {user.role === 'RESEARCHER' && <NavLink to="/orcid">ORCID import</NavLink>}
            {user.role !== 'VIEWER' && <NavLink to="/claims">Requests</NavLink>}
            {user.role === 'ADMIN' && (
              <NavLink to="/admin" end>
                Dashboard
              </NavLink>
            )}
            {user.role === 'ADMIN' && <NavLink to="/admin/users">Users</NavLink>}
            {user.role === 'ADMIN' && <NavLink to="/admin/audit">Audit log</NavLink>}
          </nav>
        )}
        {user && (
          <div className="userbox">
            <NotificationBell />
            <NavLink to="/account" className="username" title="My account">
              {user.name} <span className="role-pill">{user.researcherType?.toLowerCase() ?? user.role.toLowerCase()}</span>
            </NavLink>
            <button type="button" className="btn ghost" onClick={() => void onLogout()}>
              Log out
            </button>
          </div>
        )}
      </header>
      {user?.pendingResearcherType && (
        <p className="banner" role="status">
          Your {user.pendingResearcherType.toLowerCase()} access is waiting for an administrator to approve it. Until then you can browse and search,
          but not add publications.
        </p>
      )}
      <main className="content">
        <Outlet />
      </main>
    </div>
  );
}
