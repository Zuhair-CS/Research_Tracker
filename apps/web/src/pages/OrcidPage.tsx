import { useState, type FormEvent } from 'react';
import { api, errorMessage } from '../api/client';
import { useAuth } from '../auth/AuthContext';
import { AlertCircleIcon, CheckIcon, ExternalLinkIcon, InfoIcon, LinkIcon } from '../components/Icons';
import { useDepartments } from '../hooks';
import { typeLabel, type OrcidWork } from '../types';

interface ImportResult {
  imported: { id: string; title: string }[];
  skipped: { putCode: string; title: string; reason: string }[];
}

export function OrcidPage() {
  const { user, refresh } = useAuth();
  const departments = useDepartments();
  const [orcidInput, setOrcidInput] = useState('');
  const [works, setWorks] = useState<OrcidWork[] | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [departmentId, setDepartmentId] = useState(user?.department?.id ?? '');
  const [result, setResult] = useState<ImportResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  const onLink = (e: FormEvent) => {
    e.preventDefault();
    void run(async () => {
      await api('/orcid', { method: 'PUT', body: { orcidId: orcidInput } });
      await refresh();
      setOrcidInput('');
    });
  };

  const onUnlink = () =>
    void run(async () => {
      await api('/orcid', { method: 'DELETE' });
      setWorks(null);
      setResult(null);
      await refresh();
    });

  const loadWorks = () =>
    void run(async () => {
      const res = await api<{ works: OrcidWork[] }>('/orcid/works');
      setWorks(res.works);
      setSelected(new Set(res.works.filter((w) => !w.alreadyImported).map((w) => w.putCode)));
      setResult(null);
    });

  const onImport = () =>
    void run(async () => {
      const res = await api<ImportResult>('/orcid/import', {
        method: 'POST',
        body: { putCodes: [...selected], ...(departmentId ? { departmentId } : {}) },
      });
      setResult(res);
      const again = await api<{ works: OrcidWork[] }>('/orcid/works');
      setWorks(again.works);
      setSelected(new Set());
    });

  const toggle = (code: string) =>
    setSelected((s) => {
      const next = new Set(s);
      if (next.has(code)) next.delete(code);
      else next.add(code);
      return next;
    });

  return (
    <section>
      <div className="page-head">
        <div className="page-title-group">
          <span className="eyebrow">External Sync</span>
          <h1>ORCID import</h1>
          <p className="page-subtitle">Connect your ORCID researcher identifier to pull works directly into your profile.</p>
        </div>
      </div>

      {error && (
        <p className="alert error" role="alert">
          <AlertCircleIcon size={16} />
          <span>{error}</span>
        </p>
      )}

      <div className="card">
        {user?.orcidId ? (
          <div className="orcid-linked">
            <div className="orcid-status-group">
              <span className="tag tag-ok">
                <CheckIcon size={12} />
                <span>Connected</span>
              </span>
              <p>
                Linked ORCID iD:{' '}
                <a className="link-pill mono" href={`https://orcid.org/${user.orcidId}`} target="_blank" rel="noopener noreferrer">
                  <span>{user.orcidId}</span>
                  <ExternalLinkIcon size={11} />
                </a>
              </p>
            </div>
            <div className="actions">
              <button className="btn primary" type="button" onClick={loadWorks} disabled={busy}>
                Load my works from ORCID
              </button>
              <button className="btn ghost" type="button" onClick={onUnlink} disabled={busy}>
                Unlink
              </button>
            </div>
          </div>
        ) : (
          <form className="inline-form" onSubmit={onLink}>
            <label className="grow">
              Your ORCID iD
              <input
                value={orcidInput}
                onChange={(e) => setOrcidInput(e.target.value)}
                placeholder="0000-0002-1825-0097"
                required
                maxLength={60}
              />
            </label>
            <button className="btn primary" type="submit" disabled={busy}>
              <LinkIcon size={15} />
              <span>Link ORCID iD</span>
            </button>
          </form>
        )}
      </div>

      {result && (
        <p className="alert info" role="status">
          <InfoIcon size={16} />
          <span>
            Imported {result.imported.length} publication(s)
            {result.skipped.length > 0 && `, skipped ${result.skipped.length} (${result.skipped.map((s) => s.reason).join('; ')})`}.
          </span>
        </p>
      )}

      {works && (
        <div className="card table-card">
          <div className="table-meta-bar">
            <p className="muted small">{works.length} work(s) on your ORCID record</p>
            <div className="actions">
              <label className="inline-label">
                Department
                <select value={departmentId} onChange={(e) => setDepartmentId(e.target.value)}>
                  {!departmentId && <option value="">Choose…</option>}
                  {departments.map((d) => (
                    <option key={d.id} value={d.id}>
                      {d.name}
                    </option>
                  ))}
                </select>
              </label>
              <button className="btn primary" type="button" onClick={onImport} disabled={busy || selected.size === 0}>
                Import selected ({selected.size})
              </button>
            </div>
          </div>
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th aria-label="Select" />
                  <th>Title</th>
                  <th>Journal</th>
                  <th className="num">Year</th>
                  <th>Type</th>
                  <th>DOI</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {works.map((w) => (
                  <tr key={w.putCode} className={w.alreadyImported ? 'inactive' : ''}>
                    <td>
                      <input
                        type="checkbox"
                        aria-label={`Select ${w.title}`}
                        checked={selected.has(w.putCode)}
                        disabled={w.alreadyImported}
                        onChange={() => toggle(w.putCode)}
                      />
                    </td>
                    <td className="title-cell">
                      <span className="pub-title">{w.title || <span className="muted">(no title)</span>}</span>
                    </td>
                    <td>{w.venue ?? <span className="muted">—</span>}</td>
                    <td className="num">{w.year ?? '—'}</td>
                    <td>
                      <span className="tag">{typeLabel(w.type)}</span>
                    </td>
                    <td className="mono">{w.doi ?? '—'}</td>
                    <td>
                      {w.alreadyImported ? (
                        <span className="tag tag-ok">
                          <CheckIcon size={11} />
                          <span>Imported</span>
                        </span>
                      ) : (
                        <span className="tag tag-accent">New</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </section>
  );
}
