import { useState, type FormEvent } from 'react';
import { api, errorMessage, setCsrfToken } from '../api/client';
import { useAuth } from '../auth/AuthContext';
import { AlertCircleIcon, InfoIcon, LockIcon } from '../components/Icons';
import { initialsOf } from '../lib/format';

export function AccountPage() {
  const { user } = useAuth();
  const [currentPassword, setCurrent] = useState('');
  const [newPassword, setNew] = useState('');
  const [confirm, setConfirm] = useState('');
  const [message, setMessage] = useState<{ kind: 'error' | 'info'; text: string } | null>(null);

  if (!user) return null;

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (newPassword !== confirm) {
      setMessage({ kind: 'error', text: 'The new passwords do not match.' });
      return;
    }
    try {
      const res = await api<{ csrfToken: string }>('/auth/password', { method: 'POST', body: { currentPassword, newPassword } });
      setCsrfToken(res.csrfToken);
      setCurrent('');
      setNew('');
      setConfirm('');
      setMessage({ kind: 'info', text: 'Password changed. You have been signed out on all other devices.' });
    } catch (err) {
      setMessage({ kind: 'error', text: errorMessage(err) });
    }
  };

  return (
    <section className="narrow-page">
      <div className="page-head">
        <div className="page-title-group">
          <span className="eyebrow">Profile &amp; Security</span>
          <h1>My account</h1>
          <p className="page-subtitle">View your institutional profile details and manage your password.</p>
        </div>
      </div>

      <div className="card">
        <div className="account-hero">
          <div className="account-avatar-lg" aria-hidden="true">
            {initialsOf(user.name)}
          </div>
          <div>
            <h2>{user.name}</h2>
            <span className="tag tag-accent">
              {user.role.toLowerCase()}
              {user.researcherType && ` (${user.researcherType.toLowerCase()})`}
            </span>
          </div>
        </div>
        <dl className="details">
          <dt>Name</dt>
          <dd>{user.name}</dd>
          <dt>E-mail</dt>
          <dd>{user.email}</dd>
          <dt>Role</dt>
          <dd>
            {user.role.toLowerCase()}
            {user.researcherType && ` (${user.researcherType.toLowerCase()})`}
          </dd>
          <dt>Department</dt>
          <dd>{user.department?.name ?? '—'}</dd>
          <dt>ORCID iD</dt>
          <dd className={user.orcidId ? 'mono' : ''}>{user.orcidId ?? '—'}</dd>
        </dl>
      </div>

      <form className="card form" onSubmit={(e) => void onSubmit(e)}>
        <div className="card-head">
          <h2>Change password</h2>
        </div>
        {message && (
          <p className={`alert ${message.kind}`} role={message.kind === 'error' ? 'alert' : 'status'}>
            {message.kind === 'error' ? <AlertCircleIcon size={16} /> : <InfoIcon size={16} />}
            <span>{message.text}</span>
          </p>
        )}
        <label>
          Current password
          <input type="password" autoComplete="current-password" required value={currentPassword} onChange={(e) => setCurrent(e.target.value)} />
        </label>
        <label>
          <span>
            New password <span className="muted small">(at least 12 characters)</span>
          </span>
          <input type="password" autoComplete="new-password" required minLength={12} maxLength={128} value={newPassword} onChange={(e) => setNew(e.target.value)} />
        </label>
        <label>
          Confirm new password
          <input type="password" autoComplete="new-password" required value={confirm} onChange={(e) => setConfirm(e.target.value)} />
        </label>
        <div className="form-actions">
          <button className="btn primary" type="submit">
            <LockIcon size={15} />
            <span>Change password</span>
          </button>
        </div>
      </form>
    </section>
  );
}
