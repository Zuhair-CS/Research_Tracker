import { Fragment, useState, type FormEvent } from 'react';
import { api } from '../api/client';
import { AlertCircleIcon, ChevronLeftIcon, ChevronRightIcon } from '../components/Icons';
import { useAsync } from '../hooks';
import type { AuditEntry, Page } from '../types';

const ACTIONS = [
  'LOGIN',
  'LOGIN_FAILED',
  'LOGOUT',
  'PASSWORD_CHANGE',
  'PUBLICATION_CREATE',
  'PUBLICATION_UPDATE',
  'PUBLICATION_DELETE',
  'ORCID_LINK',
  'ORCID_UNLINK',
  'ORCID_IMPORT',
  'OPENALEX_IMPORT',
  'USER_CREATE',
  'USER_UPDATE',
  'REPORT_EXPORT',
];

/** Short description of what changed, from the before/after snapshots. */
function summarise(entry: AuditEntry): string {
  const before = (entry.before ?? {}) as Record<string, unknown>;
  const after = (entry.after ?? {}) as Record<string, unknown>;
  if (entry.action === 'PUBLICATION_UPDATE') {
    const changed = Object.keys(after).filter(
      (k) => !['updatedAt', 'createdAt'].includes(k) && JSON.stringify(before[k]) !== JSON.stringify(after[k]),
    );
    return changed.length ? `Changed: ${changed.join(', ')}` : 'No field changes';
  }
  const title = (after.title ?? before.title) as string | undefined;
  if (title) return String(title);
  if (entry.action === 'LOGIN_FAILED') return `E-mail: ${String(after.email ?? '')} (${String(after.reason ?? '')})`;
  if (entry.action === 'OPENALEX_IMPORT' || entry.action === 'ORCID_IMPORT') {
    const into = after.owner ? ` into ${String(after.owner)}'s account` : '';
    return `Imported ${String(after.imported ?? 0)}, skipped ${String(after.skipped ?? 0)}${into}`;
  }
  if (entry.entityType === 'Report') return entry.entityId ?? '';
  if (after.orcidId || before.orcidId) return `ORCID ${String(after.orcidId ?? before.orcidId)}`;
  return '';
}

export function AuditLogPage() {
  const [filters, setFilters] = useState({ action: '', entityType: '', from: '', to: '' });
  const [page, setPage] = useState(1);
  const [open, setOpen] = useState<string | null>(null);

  const { data, error, loading } = useAsync(
    () =>
      api<Page<AuditEntry>>('/admin/audit-logs', {
        query: {
          ...filters,
          // "to" is inclusive of the whole chosen day
          to: filters.to ? `${filters.to}T23:59:59.999Z` : '',
          page,
          pageSize: 25,
        },
      }),
    [filters, page],
  );

  const onFilter = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    setPage(1);
    setFilters({
      action: String(f.get('action') ?? ''),
      entityType: String(f.get('entityType') ?? ''),
      from: String(f.get('from') ?? ''),
      to: String(f.get('to') ?? ''),
    });
  };

  const totalPages = data ? Math.max(1, Math.ceil(data.total / data.pageSize)) : 1;

  return (
    <section>
      <div className="page-head">
        <div className="page-title-group">
          <span className="eyebrow">Security &amp; Compliance</span>
          <h1>Audit log</h1>
          <p className="page-subtitle">Immutable record of authentication, data modifications, imports, and report exports.</p>
        </div>
      </div>

      <form className="card filters" onSubmit={onFilter}>
        <label>
          Action
          <select name="action" defaultValue="">
            <option value="">All</option>
            {ACTIONS.map((a) => (
              <option key={a}>{a}</option>
            ))}
          </select>
        </label>
        <label>
          Record type
          <select name="entityType" defaultValue="">
            <option value="">All</option>
            <option>Publication</option>
            <option>User</option>
            <option>Session</option>
            <option>Report</option>
          </select>
        </label>
        <label>
          From
          <input type="date" name="from" />
        </label>
        <label>
          To
          <input type="date" name="to" />
        </label>
        <div className="filter-buttons">
          <button className="btn primary" type="submit">
            Filter
          </button>
        </div>
      </form>

      {error && (
        <p className="alert error" role="alert">
          <AlertCircleIcon size={16} />
          <span>{error}</span>
        </p>
      )}

      <div className="card table-card">
        <div className="table-meta-bar">
          <p className="muted small">{loading ? 'Loading…' : `${data?.total ?? 0} event(s)`}</p>
        </div>
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th>When</th>
                <th>Who</th>
                <th>Action</th>
                <th>Record</th>
                <th>Details</th>
                <th>IP</th>
                <th aria-label="Expand" />
              </tr>
            </thead>
            <tbody>
              {data?.items.map((e) => (
                <Fragment key={e.id}>
                  <tr>
                    <td className="nowrap mono">{new Date(e.createdAt).toLocaleString()}</td>
                    <td>{e.actor ? `${e.actor.name} (${e.actor.email})` : <span className="muted">anonymous</span>}</td>
                    <td>
                      <span
                        className={`tag tag-mono ${e.action.endsWith('FAILED') || e.action.endsWith('DELETE') ? 'tag-warn' : ''}`}
                      >
                        {e.action}
                      </span>
                    </td>
                    <td>{e.entityType}</td>
                    <td>{summarise(e)}</td>
                    <td className="nowrap mono">{e.ip ?? '—'}</td>
                    <td>
                      {(e.before !== null || e.after !== null) && (
                        <button className="btn small ghost" type="button" onClick={() => setOpen(open === e.id ? null : e.id)}>
                          {open === e.id ? 'Hide' : 'Show'}
                        </button>
                      )}
                    </td>
                  </tr>
                  {open === e.id && (
                    <tr key={`${e.id}-detail`} className="detail-row">
                      <td colSpan={7}>
                        <div className="diff">
                          <div className="diff-pane">
                            <strong>Before</strong>
                            <pre>{JSON.stringify(e.before, null, 2) ?? '—'}</pre>
                          </div>
                          <div className="diff-pane">
                            <strong>After</strong>
                            <pre>{JSON.stringify(e.after, null, 2) ?? '—'}</pre>
                          </div>
                        </div>
                      </td>
                    </tr>
                  )}
                </Fragment>
              ))}
              {data && data.items.length === 0 && (
                <tr>
                  <td colSpan={7} className="empty-state">
                    No audit events match these filters.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        {totalPages > 1 && (
          <div className="pager">
            <span className="muted small">
              Page {page} of {totalPages}
            </span>
            <div className="pager-controls">
              <button className="btn small" type="button" disabled={page <= 1} onClick={() => setPage(page - 1)}>
                <ChevronLeftIcon size={14} />
                <span>Previous</span>
              </button>
              <button className="btn small" type="button" disabled={page >= totalPages} onClick={() => setPage(page + 1)}>
                <span>Next</span>
                <ChevronRightIcon size={14} />
              </button>
            </div>
          </div>
        )}
      </div>
    </section>
  );
}
