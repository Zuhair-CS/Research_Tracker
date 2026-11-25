import { useState, type FormEvent } from 'react';
import { Link, Navigate, useLocation, useNavigate } from 'react-router';
import { errorMessage } from '../api/client';
import { useAuth } from '../auth/AuthContext';
import { AlertCircleIcon, BrandCrestIcon, CheckIcon, LockIcon } from '../components/Icons';

export function LoginPage() {
  const { user, login } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const from = (location.state as { from?: string } | null)?.from ?? '/';
  if (user) return <Navigate to={from} replace />;

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await login(email, password);
      navigate(from, { replace: true });
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="auth-shell">
      <aside className="auth-hero" aria-label="About Publication Tracker">
        <div>
          <div className="auth-hero-eyebrow">
            <BrandCrestIcon size={15} />
            <span>PB-1 Academic Portal</span>
          </div>
          <h2 className="auth-hero-title">Scholarly output, verified &amp; unified.</h2>
          <p className="auth-hero-copy">
            Centralize departmental research records, discover works across OpenAlex and Crossref, and verify authorship through consent-first claim workflows.
          </p>
          <ul className="auth-highlights">
            <li>
              <span className="auth-check" aria-hidden="true">
                <CheckIcon size={13} />
              </span>
              <span>Search and export university-wide publication records by department, type, or year</span>
            </li>
            <li>
              <span className="auth-check" aria-hidden="true">
                <CheckIcon size={13} />
              </span>
              <span>Auto-fill metadata from DOIs or sync records directly from your linked ORCID profile</span>
            </li>
            <li>
              <span className="auth-check" aria-hidden="true">
                <CheckIcon size={13} />
              </span>
              <span>Role-based governance with full administrative analytics and audit trails</span>
            </li>
          </ul>
        </div>
        <div className="auth-hero-meta">University Research Publication Tracking System</div>
      </aside>

      <div className="auth-panel">
        <form className="login" onSubmit={(e) => void onSubmit(e)} aria-labelledby="login-title">
          <div className="auth-header">
            <h1 id="login-title">Sign in</h1>
            <p className="muted">University Research Publication Tracking System</p>
          </div>
          {error && (
            <p className="alert error" role="alert">
              <AlertCircleIcon size={16} />
              <span>{error}</span>
            </p>
          )}
          <label>
            E-mail
            <input type="email" name="email" autoComplete="username" required value={email} onChange={(e) => setEmail(e.target.value)} />
          </label>
          <label>
            Password
            <input
              type="password"
              name="password"
              autoComplete="current-password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </label>
          <button className="btn primary full-width" type="submit" disabled={busy}>
            <LockIcon size={15} />
            <span>{busy ? 'Signing in…' : 'Sign in'}</span>
          </button>
          <p className="auth-footer">
            New here? <Link to="/signup">Create an account</Link>
          </p>
        </form>
      </div>
    </div>
  );
}
