import { useState } from 'react';
import { Link, useParams } from 'react-router';
import { api, errorMessage } from '../api/client';
import { useAuth } from '../auth/AuthContext';
import { useAsync, useDepartments } from '../hooks';
import { typeLabel, type Claim } from '../types';

const STATUS_LABEL: Record<Claim['status'], string> = {
  PENDING: 'Waiting for the researcher',
  APPROVED: 'Approved',
  REJECTED: 'Rejected',
  CANCELLED: 'Withdrawn',
};

/**
 * One claim request. The researcher it is addressed to reviews the papers,
 * unticks any that are not theirs, and approves or rejects. Admins see status.
 */
export function ClaimPage() {
  const { id } = useParams();
  const { user } = useAuth();
  const departments = useDepartments();
  const { data: claim, error, reload } = useAsync(() => api<Claim>(`/claims/${id}`), [id]);
  const [unticked, setUnticked] = useState<Set<string>>(new Set());
  const [departmentId, setDepartmentId] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ kind: 'info' | 'error'; text: string } | null>(null);

  if (error) return <p className="alert error">{error}</p>;
  if (!claim) return <p className="muted">Loading…</p>;

  const works = claim.works ?? [];
  const isMine = user?.id === claim.researcher.id;
  const canAnswer = isMine && claim.status === 'PENDING';
  const chosen = works.filter((w) => !w.alreadyImported && !unticked.has(w.key));
  const dept = departmentId || user?.department?.id || '';

  const act = async (fn: () => Promise<string>) => {
    setBusy(true);
    setMessage(null);
    try {
      setMessage({ kind: 'info', text: await fn() });
      reload();
    } catch (err) {
      setMessage({ kind: 'error', text: errorMessage(err) });
    } finally {
      setBusy(false);
    }
  };

  const approve = () =>
    act(async () => {
      const res = await api<{ imported: unknown[]; skipped: unknown[] }>(`/claims/${claim.id}/approve`, {
        method: 'POST',
        body: { keys: chosen.map((w) => w.key), ...(dept ? { departmentId: dept } : {}) },
      });
      return `Done: ${res.imported.length} paper(s) added to your profile${res.skipped.length ? `, ${res.skipped.length} skipped` : ''}.`;
    });
  const reject = () =>
    act(async () => {
      await api(`/claims/${claim.id}/reject`, { method: 'POST', body: note.trim() ? { note: note.trim() } : {} });
      return 'You rejected this request. Nothing was added to your profile.';
    });
  const cancel = () =>
    act(async () => {
      await api(`/claims/${claim.id}/cancel`, { method: 'POST' });
      return 'Request withdrawn.';
    });

  return (
    <section>
      <div className="page-head">
        <h1>{isMine ? 'Are these your papers?' : 'Claim request'}</h1>
        <Link className="btn ghost" to="/claims">
          All requests
        </Link>
      </div>

      <div className="card claim-head">
        <p>
          <strong>{claim.requestedBy.name}</strong> found the profile <strong>“{claim.authorName}”</strong>
          {claim.authorInstitution && ` (${claim.authorInstitution})`} and asked{' '}
          <strong>{isMine ? 'you' : claim.researcher.name}</strong> to confirm {works.length} paper(s).
        </p>
        {claim.message && <blockquote>{claim.message}</blockquote>}
        <p className="small">
          <span className={`tag status-${claim.status.toLowerCase()}`}>{STATUS_LABEL[claim.status]}</span>{' '}
          <span className="muted">
            Sent {new Date(claim.createdAt).toLocaleString()}
            {claim.respondedAt && ` · answered ${new Date(claim.respondedAt).toLocaleString()}`}
            {claim.status === 'APPROVED' && ` · ${claim.importedCount} paper(s) added`}
            {claim.responseNote && ` · note: “${claim.responseNote}”`}
          </span>
        </p>
      </div>

      {message && <p className={`alert ${message.kind}`}>{message.text}</p>}

      {canAnswer && (
        <div className="card action-bar">
          <span className="muted small grow-text">
            Untick anything that is not yours. Approving adds the {chosen.length} ticked paper(s) to your profile.
          </span>
          <label className="inline-label">
            Department
            <select value={dept} onChange={(e) => setDepartmentId(e.target.value)}>
              {!dept && <option value="">Choose…</option>}
              {departments.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.name}
                </option>
              ))}
            </select>
          </label>
          <button className="btn primary" type="button" disabled={busy || chosen.length === 0 || !dept} onClick={() => void approve()}>
            Yes, these are mine ({chosen.length})
          </button>
          <input className="grow-input" placeholder="Optional note if rejecting" maxLength={500} value={note} onChange={(e) => setNote(e.target.value)} />
          <button className="btn danger" type="button" disabled={busy} onClick={() => void reject()}>
            Not me, reject
          </button>
        </div>
      )}
      {user?.role === 'ADMIN' && claim.status === 'PENDING' && (
        <div className="card action-bar">
          <span className="muted small grow-text">Waiting for {claim.researcher.name} to answer.</span>
          <button className="btn danger" type="button" disabled={busy} onClick={() => void cancel()}>
            Withdraw request
          </button>
        </div>
      )}

      <div className="card table-card">
        <div className="list-head">
          <span className="muted small">{works.length} paper(s) in this request</span>
          {canAnswer && (
            <button
              className="btn small ghost"
              type="button"
              onClick={() => setUnticked(unticked.size ? new Set() : new Set(works.map((w) => w.key)))}
            >
              {unticked.size ? 'Tick all' : 'Untick all'}
            </button>
          )}
        </div>
        <ul className="work-list">
          {works.map((w) => (
            <li key={w.key} className={w.alreadyImported ? 'is-imported' : ''}>
              {canAnswer && (
                <input
                  type="checkbox"
                  aria-label={`Keep ${w.title}`}
                  disabled={w.alreadyImported}
                  checked={!w.alreadyImported && !unticked.has(w.key)}
                  onChange={() =>
                    setUnticked((s) => {
                      const n = new Set(s);
                      if (n.has(w.key)) n.delete(w.key);
                      else n.add(w.key);
                      return n;
                    })
                  }
                />
              )}
              <div className="work-body">
                <div className="work-title">
                  {w.doi ? (
                    <a href={`https://doi.org/${encodeURI(w.doi)}`} target="_blank" rel="noopener noreferrer">
                      {w.title || '(no title)'}
                    </a>
                  ) : (
                    w.title || '(no title)'
                  )}
                </div>
                <div className="work-authors">{w.authors.join(', ')}</div>
                <div className="work-meta">
                  {[w.venue, w.year, typeLabel(w.type)].filter(Boolean).join(' · ')}
                  <span>Cited by {w.citedByCount.toLocaleString()}</span>
                  {w.alreadyImported && <span className="tag tag-ok">Already in your profile</span>}
                </div>
              </div>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}
