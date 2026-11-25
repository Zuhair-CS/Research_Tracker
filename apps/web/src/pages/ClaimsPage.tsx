import { useState } from 'react';
import { Link } from 'react-router';
import { api } from '../api/client';
import { useAuth } from '../auth/AuthContext';
import { useAsync } from '../hooks';
import type { Claim, ClaimStatus } from '../types';

/** Admins: every claim request they sent. Researchers: requests addressed to them. */
export function ClaimsPage() {
  const { user } = useAuth();
  const [status, setStatus] = useState<ClaimStatus | ''>('');
  const { data, error, loading } = useAsync(() => api<{ items: Claim[] }>('/claims', { query: { status } }), [status]);
  const isAdmin = user?.role === 'ADMIN';

  return (
    <section>
      <div className="page-head">
        <h1>{isAdmin ? 'Claim requests' : 'Requests for me'}</h1>
        <label className="inline-label">
          Status
          <select value={status} onChange={(e) => setStatus(e.target.value as ClaimStatus | '')}>
            <option value="">All</option>
            <option value="PENDING">Waiting</option>
            <option value="APPROVED">Approved</option>
            <option value="REJECTED">Rejected</option>
            <option value="CANCELLED">Withdrawn</option>
          </select>
        </label>
      </div>
      {isAdmin && (
        <p className="muted small">
          Send a request from <Link to="/find">Find research</Link>: open a person's papers and choose “Send to researcher”.
        </p>
      )}
      {error && <p className="alert error">{error}</p>}
      <div className="card table-card">
        <p className="muted small">{loading ? 'Loading…' : `${data?.items.length ?? 0} request(s)`}</p>
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th>Sent</th>
                <th>Profile found</th>
                {isAdmin && <th>Sent to</th>}
                {!isAdmin && <th>From</th>}
                <th>Status</th>
                <th className="num">Added</th>
                <th aria-label="Open" />
              </tr>
            </thead>
            <tbody>
              {data?.items.map((c) => (
                <tr key={c.id}>
                  <td className="nowrap">{new Date(c.createdAt).toLocaleDateString()}</td>
                  <td>
                    <span className="pub-title">{c.authorName}</span>
                    {c.authorInstitution && <span className="muted small">{c.authorInstitution}</span>}
                  </td>
                  {isAdmin ? (
                    <td>
                      {c.researcher.name} <span className="muted small">({c.researcher.department?.code ?? '—'})</span>
                    </td>
                  ) : (
                    <td>{c.requestedBy.name}</td>
                  )}
                  <td>
                    <span className={`tag status-${c.status.toLowerCase()}`}>{c.status.toLowerCase()}</span>
                  </td>
                  <td className="num">{c.status === 'APPROVED' ? c.importedCount : '—'}</td>
                  <td>
                    <Link className="btn small" to={`/claims/${c.id}`}>
                      {!isAdmin && c.status === 'PENDING' ? 'Review' : 'Open'}
                    </Link>
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
