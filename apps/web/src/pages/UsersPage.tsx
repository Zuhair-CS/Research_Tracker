import { useState, type FormEvent } from 'react';
import { api, errorMessage } from '../api/client';
import { useAuth } from '../auth/AuthContext';
import { useAsync, useDepartments } from '../hooks';
import type { Role, User } from '../types';

export function UsersPage() {
  const { user: me } = useAuth();
  const departments = useDepartments();
  const { data, error, reload } = useAsync(() => api<{ items: User[] }>('/admin/users'), []);
  const [message, setMessage] = useState<{ kind: 'error' | 'info'; text: string } | null>(null);
  const [role, setRole] = useState<Role>('RESEARCHER');

  const update = async (u: User, changes: Partial<{ role: Role; active: boolean; departmentId: string | null }>) => {
    setMessage(null);
    try {
      await api(`/admin/users/${u.id}`, { method: 'PATCH', body: changes });
      reload();
    } catch (err) {
      setMessage({ kind: 'error', text: errorMessage(err) });
    }
  };

  const decideAccess = async (u: User, decision: 'approve' | 'reject') => {
    setMessage(null);
    try {
      await api(`/admin/users/${u.id}/access`, { method: 'POST', body: { decision } });
      setMessage({ kind: 'info', text: decision === 'approve' ? `Approved ${u.name} as ${u.pendingResearcherType?.toLowerCase()}.` : `Rejected ${u.name}'s request.` });
      reload();
    } catch (err) {
      setMessage({ kind: 'error', text: errorMessage(err) });
    }
  };

  const pending = data?.items.filter((u) => u.pendingResearcherType && u.active) ?? [];

  const onCreate = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const formEl = e.currentTarget;
    const f = new FormData(formEl);
    setMessage(null);
    try {
      await api('/admin/users', {
        method: 'POST',
        body: {
          name: f.get('name'),
          email: f.get('email'),
          password: f.get('password'),
          role: f.get('role'),
          researcherType: f.get('role') === 'RESEARCHER' ? f.get('researcherType') : null,
          departmentId: f.get('departmentId') || null,
        },
      });
      formEl.reset();
      setRole('RESEARCHER');
      setMessage({ kind: 'info', text: 'User created.' });
      reload();
    } catch (err) {
      setMessage({ kind: 'error', text: errorMessage(err) });
    }
  };

  return (
    <section>
      <div className="page-head">
        <h1>Users</h1>
      </div>
      {(error || message) && (
        <p className={`alert ${message?.kind ?? 'error'}`} role="alert">
          {error ?? message?.text}
        </p>
      )}

      {pending.length > 0 && (
        <div className="card table-card">
          <div className="list-head">
            <span className="small">
              <strong>Access requests</strong> <span className="muted">· people who signed up and asked for researcher access</span>
            </span>
          </div>
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>Name</th>
                  <th>E-mail</th>
                  <th>Asked for</th>
                  <th>Department</th>
                  <th>Signed up</th>
                  <th aria-label="Actions" />
                </tr>
              </thead>
              <tbody>
                {pending.map((u) => (
                  <tr key={u.id}>
                    <td>{u.name}</td>
                    <td>{u.email}</td>
                    <td>{u.pendingResearcherType?.toLowerCase()}</td>
                    <td>{u.department?.code ?? '—'}</td>
                    <td className="nowrap">{new Date(u.createdAt).toLocaleDateString()}</td>
                    <td className="row-actions">
                      <button className="btn small primary" type="button" onClick={() => void decideAccess(u, 'approve')}>
                        Approve
                      </button>
                      <button className="btn small danger" type="button" onClick={() => void decideAccess(u, 'reject')}>
                        Reject
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <form className="card filters" onSubmit={(e) => void onCreate(e)} aria-label="Create user">
        <label>
          Name
          <input name="name" required maxLength={200} />
        </label>
        <label>
          E-mail
          <input name="email" type="email" required maxLength={254} />
        </label>
        <label>
          Initial password
          <input name="password" type="password" required minLength={12} maxLength={128} autoComplete="new-password" />
        </label>
        <label>
          Role
          <select name="role" value={role} onChange={(e) => setRole(e.target.value as Role)}>
            <option value="RESEARCHER">Researcher</option>
            <option value="VIEWER">Viewer</option>
            <option value="ADMIN">Admin</option>
          </select>
        </label>
        {role === 'RESEARCHER' && (
          <label>
            Researcher type
            <select name="researcherType" defaultValue="FACULTY">
              <option value="FACULTY">Faculty</option>
              <option value="STUDENT">Student</option>
            </select>
          </label>
        )}
        <label>
          Department
          <select name="departmentId" defaultValue="">
            <option value="">—</option>
            {departments.map((d) => (
              <option key={d.id} value={d.id}>
                {d.name}
              </option>
            ))}
          </select>
        </label>
        <div className="filter-buttons">
          <button className="btn primary" type="submit">
            Create user
          </button>
        </div>
      </form>

      <div className="card table-card">
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th>Name</th>
                <th>E-mail</th>
                <th>Role</th>
                <th>Department</th>
                <th>ORCID</th>
                <th>Status</th>
                <th aria-label="Actions" />
              </tr>
            </thead>
            <tbody>
              {data?.items.map((u) => (
                <tr key={u.id} className={u.active ? '' : 'inactive'}>
                  <td>
                    {u.name}
                    {u.researcherType && <span className="muted small"> · {u.researcherType.toLowerCase()}</span>}
                  </td>
                  <td>{u.email}</td>
                  <td>
                    <select
                      aria-label={`Role of ${u.name}`}
                      value={u.role}
                      disabled={u.id === me?.id}
                      onChange={(e) => void update(u, { role: e.target.value as Role })}
                    >
                      <option value="ADMIN">Admin</option>
                      <option value="RESEARCHER">Researcher</option>
                      <option value="VIEWER">Viewer</option>
                    </select>
                  </td>
                  <td>{u.department?.code ?? '—'}</td>
                  <td>{u.orcidId ?? '—'}</td>
                  <td>{u.active ? 'Active' : 'Disabled'}</td>
                  <td>
                    {u.id !== me?.id && (
                      <button className={`btn small ${u.active ? 'danger' : ''}`} type="button" onClick={() => void update(u, { active: !u.active })}>
                        {u.active ? 'Disable' : 'Enable'}
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </section>
  );
}
