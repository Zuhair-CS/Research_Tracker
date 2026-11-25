import { useState, type FormEvent } from 'react';
import { Link, Navigate, useNavigate } from 'react-router';
import { api, errorMessage } from '../api/client';
import { useAuth } from '../auth/AuthContext';
import { AlertCircleIcon, BrandCrestIcon, CheckIcon } from '../components/Icons';
import { useAsync } from '../hooks';

interface SignupOptions {
  enabled: boolean;
  allowedDomains: string[];
  departments: { id: string; name: string }[];
}

export function SignupPage() {
  const { user, signup } = useAuth();
  const navigate = useNavigate();
  const { data: options } = useAsync(() => api<SignupOptions>('/auth/signup-options'), []);
  const [form, setForm] = useState({ name: '', email: '', password: '', confirm: '', researcherType: 'FACULTY', departmentId: '' });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  if (user) return <Navigate to="/" replace />;
  const set = (k: keyof typeof form, v: string) => setForm((f) => ({ ...f, [k]: v }));

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (form.password !== form.confirm) {
      setError('The passwords do not match.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await signup({
        name: form.name,
        email: form.email,
        password: form.password,
        researcherType: form.researcherType as 'FACULTY' | 'STUDENT',
        departmentId: form.departmentId,
      });
      navigate('/', { replace: true });
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  if (options && !options.enabled) {
    return (
      <div className="login-wrap">
        <div className="card login login-standalone">
          <h1>Sign-up is closed</h1>
          <p className="muted">Ask an administrator to create an account for you.</p>
          <Link className="btn primary" to="/login">
            Back to sign in
          </Link>
        </div>
      </div>
    );
  }

  const domainHint = options?.allowedDomains.length ? options.allowedDomains.map((d) => `@${d}`).join(' or ') : null;

  return (
    <div className="auth-shell">
      <aside className="auth-hero" aria-label="Account access overview">
        <div>
          <div className="auth-hero-eyebrow">
            <BrandCrestIcon size={15} />
            <span>Researcher Onboarding</span>
          </div>
          <h2 className="auth-hero-title">Join your university research registry.</h2>
          <p className="auth-hero-copy">
            Create an account to browse institutional publications immediately. Faculty and student contributor permissions activate after administrator review.
          </p>
          <ul className="auth-highlights">
            <li>
              <span className="auth-check" aria-hidden="true">
                <CheckIcon size={13} />
              </span>
              <span>Immediate read-only browsing across departments and external scholarly indices</span>
            </li>
            <li>
              <span className="auth-check" aria-hidden="true">
                <CheckIcon size={13} />
              </span>
              <span>Once approved, add publications manually, via DOI, or from ORCID</span>
            </li>
            <li>
              <span className="auth-check" aria-hidden="true">
                <CheckIcon size={13} />
              </span>
              <span>Receive notifications for publication claim requests and access updates</span>
            </li>
          </ul>
        </div>
        <div className="auth-hero-meta">Passwords require at least 12 characters for account security.</div>
      </aside>

      <div className="auth-panel">
        <form className="login" onSubmit={(e) => void onSubmit(e)} aria-labelledby="signup-title">
          <div className="auth-header">
            <h1 id="signup-title">Create an account</h1>
            <p className="muted small">
              You can browse straight away. Faculty or student access (adding and importing publications) is switched on once an administrator approves it.
            </p>
          </div>
          {error && (
            <p className="alert error" role="alert">
              <AlertCircleIcon size={16} />
              <span>{error}</span>
            </p>
          )}
          <label>
            Full name
            <input required minLength={2} maxLength={200} autoComplete="name" value={form.name} onChange={(e) => set('name', e.target.value)} />
          </label>
          <label>
            University e-mail
            <input
              type="email"
              required
              maxLength={254}
              autoComplete="email"
              placeholder={domainHint ? `name${domainHint.split(' ')[0]}` : 'name@university.edu'}
              value={form.email}
              onChange={(e) => set('email', e.target.value)}
            />
          </label>
          <div className="row-2">
            <label>
              I am
              <select value={form.researcherType} onChange={(e) => set('researcherType', e.target.value)}>
                <option value="FACULTY">Faculty</option>
                <option value="STUDENT">Student</option>
              </select>
            </label>
            <label>
              Department
              <select required value={form.departmentId} onChange={(e) => set('departmentId', e.target.value)}>
                <option value="">Choose…</option>
                {options?.departments.map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.name}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <label>
            Password <span className="muted small">(at least 12 characters)</span>
            <input
              type="password"
              required
              minLength={12}
              maxLength={128}
              autoComplete="new-password"
              value={form.password}
              onChange={(e) => set('password', e.target.value)}
            />
          </label>
          <label>
            Confirm password
            <input type="password" required autoComplete="new-password" value={form.confirm} onChange={(e) => set('confirm', e.target.value)} />
          </label>
          <button className="btn primary full-width" type="submit" disabled={busy}>
            {busy ? 'Creating account…' : 'Create account'}
          </button>
          <p className="auth-footer">
            Already have an account? <Link to="/login">Sign in</Link>
          </p>
        </form>
      </div>
    </div>
  );
}
