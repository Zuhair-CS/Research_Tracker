import { useEffect, useState } from 'react';
import { Link, NavLink, Outlet, useLocation, useNavigate } from 'react-router';
import { useAuth } from '../auth/AuthContext';
import { initialsOf } from '../lib/format';
import {
  BookOpenIcon,
  BrandCrestIcon,
  ChartBarIcon,
  CompassIcon,
  InboxIcon,
  InfoIcon,
  LinkIcon,
  LogOutIcon,
  MenuIcon,
  MoonIcon,
  PlusCircleIcon,
  ShieldIcon,
  SunIcon,
  UsersIcon,
  XIcon,
} from './Icons';
import { NotificationBell } from './NotificationBell';

type ThemeMode = 'light' | 'dark';

function resolveInitialTheme(): ThemeMode {
  try {
    const saved = localStorage.getItem('pb1-theme');
    if (saved === 'light' || saved === 'dark') return saved;
  } catch {
    // ignore storage errors
  }
  return window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

export function Layout() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [theme, setTheme] = useState<ThemeMode>(resolveInitialTheme);
  const [menuOpenPath, setMenuOpenPath] = useState<string | null>(null);
  const menuOpen = menuOpenPath === location.pathname;

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    try {
      localStorage.setItem('pb1-theme', theme);
    } catch {
      // ignore storage errors
    }
  }, [theme]);

  const toggleTheme = () => setTheme((t) => (t === 'dark' ? 'light' : 'dark'));

  const onLogout = async () => {
    await logout();
    navigate('/login');
  };

  const isAuthScreen = !user && (location.pathname === '/login' || location.pathname === '/signup');

  return (
    <div className="app">
      <header className={`topbar${isAuthScreen ? ' topbar-auth' : ''}`}>
        <div className="topbar-inner">
          {user ? (
            <Link to="/" className="brand">
              <span className="brand-mark" aria-hidden="true">
                <BrandCrestIcon size={18} />
              </span>
              <span className="brand-text">
                <span className="brand-name">Publication Tracker</span>
                <span className="brand-sub">Research Registry</span>
              </span>
            </Link>
          ) : (
            <div className="brand">
              <span className="brand-mark" aria-hidden="true">
                <BrandCrestIcon size={18} />
              </span>
              <span className="brand-text">
                <span className="brand-name">Publication Tracker</span>
                <span className="brand-sub">Research Registry</span>
              </span>
            </div>
          )}

          {user && (
            <nav id="main-nav" className={`nav${menuOpen ? ' is-open' : ''}`} aria-label="Main">
              <NavLink to="/" end>
                <BookOpenIcon size={15} />
                <span>Publications</span>
              </NavLink>
              <NavLink to="/find">
                <CompassIcon size={15} />
                <span>Find research</span>
              </NavLink>
              {user.role === 'RESEARCHER' && (
                <NavLink to="/publications/new">
                  <PlusCircleIcon size={15} />
                  <span>Add publication</span>
                </NavLink>
              )}
              {user.role === 'RESEARCHER' && (
                <NavLink to="/orcid">
                  <LinkIcon size={15} />
                  <span>ORCID import</span>
                </NavLink>
              )}
              {user.role !== 'VIEWER' && (
                <NavLink to="/claims">
                  <InboxIcon size={15} />
                  <span>Requests</span>
                </NavLink>
              )}
              {user.role === 'ADMIN' && (
                <>
                  <span className="nav-divider" aria-hidden="true" />
                  <NavLink to="/admin" end>
                    <ChartBarIcon size={15} />
                    <span>Dashboard</span>
                  </NavLink>
                  <NavLink to="/admin/users">
                    <UsersIcon size={15} />
                    <span>Users</span>
                  </NavLink>
                  <NavLink to="/admin/audit">
                    <ShieldIcon size={15} />
                    <span>Audit log</span>
                  </NavLink>
                </>
              )}
            </nav>
          )}

          <div className="userbox">
            <button
              type="button"
              className="icon-btn"
              onClick={toggleTheme}
              aria-label={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
              title={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
            >
              {theme === 'dark' ? <SunIcon size={17} /> : <MoonIcon size={17} />}
            </button>

            {user && (
              <>
                <NotificationBell />
                <NavLink to="/account" className="username" title="My account">
                  <span className="avatar-badge" aria-hidden="true">
                    {initialsOf(user.name)}
                  </span>
                  <span className="username-label">{user.name}</span>
                  <span className="role-pill">{user.researcherType?.toLowerCase() ?? user.role.toLowerCase()}</span>
                </NavLink>
                <button type="button" className="btn ghost small logout-btn" onClick={() => void onLogout()}>
                  <LogOutIcon size={15} />
                  <span>Log out</span>
                </button>
                <button
                  type="button"
                  className="icon-btn nav-toggle"
                  aria-expanded={menuOpen}
                  aria-controls="main-nav"
                  aria-label={menuOpen ? 'Close navigation menu' : 'Open navigation menu'}
                  onClick={() => setMenuOpenPath((p) => (p === location.pathname ? null : location.pathname))}
                >
                  {menuOpen ? <XIcon size={18} /> : <MenuIcon size={18} />}
                </button>
              </>
            )}
          </div>
        </div>
      </header>

      {user?.pendingResearcherType && (
        <div className="banner" role="status">
          <div className="banner-inner">
            <InfoIcon size={16} />
            <span>
              Your {user.pendingResearcherType.toLowerCase()} access is waiting for an administrator to approve it. Until then you can browse and
              search, but not add publications.
            </span>
          </div>
        </div>
      )}

      <main className={isAuthScreen ? 'content content-auth' : 'content'}>
        <Outlet />
      </main>
    </div>
  );
}
