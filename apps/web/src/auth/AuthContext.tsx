import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { Navigate, useLocation } from 'react-router';
import { ApiError, api, setCsrfToken } from '../api/client';
import type { Role, User } from '../types';

interface AuthState {
  user: User | null;
  loading: boolean;
  login: (email: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  refresh: () => Promise<void>;
  signup: (data: SignupData) => Promise<void>;
}

export interface SignupData {
  name: string;
  email: string;
  password: string;
  researcherType: 'FACULTY' | 'STUDENT';
  departmentId: string;
}

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    try {
      setUser((await api<{ user: User }>('/auth/me')).user);
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) setUser(null);
      else throw err;
    } finally {
      setLoading(false);
    }
  }, []);

  // On first load, ask the server whether this browser already has a valid session.
  useEffect(() => {
    let cancelled = false;
    api<{ user: User }>('/auth/me')
      .then(
        (res) => !cancelled && setUser(res.user),
        () => !cancelled && setUser(null),
      )
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, []);

  const login = useCallback(async (email: string, password: string) => {
    const res = await api<{ user: User; csrfToken: string }>('/auth/login', { method: 'POST', body: { email, password } });
    // The server issued a new session at login, which comes with a new CSRF token.
    setCsrfToken(res.csrfToken);
    setUser(res.user);
  }, []);

  const signup = useCallback(async (data: SignupData) => {
    // The new account is signed in straight away (new session + CSRF token, as at login).
    const res = await api<{ user: User; csrfToken: string }>('/auth/signup', { method: 'POST', body: data });
    setCsrfToken(res.csrfToken);
    setUser(res.user);
  }, []);

  const logout = useCallback(async () => {
    await api('/auth/logout', { method: 'POST' });
    setCsrfToken(null);
    setUser(null);
  }, []);

  const value = useMemo(() => ({ user, loading, login, logout, refresh, signup }), [user, loading, login, logout, refresh, signup]);
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside <AuthProvider>');
  return ctx;
}

/**
 * Hides pages from users without the right role.
 * NOTE: this is only for a nicer user experience. The real security check is
 * on the server (requireRole), because anyone can call the API directly.
 */
export function RequireAuth({ roles, children }: { roles?: Role[]; children: ReactNode }) {
  const { user, loading } = useAuth();
  const location = useLocation();
  if (loading) return <p className="muted pad">Loading…</p>;
  if (!user) return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  if (roles && !roles.includes(user.role)) {
    return (
      <div className="card">
        <h1>Access denied</h1>
        <p>Your role ({user.role.toLowerCase()}) cannot open this page.</p>
      </div>
    );
  }
  return <>{children}</>;
}
