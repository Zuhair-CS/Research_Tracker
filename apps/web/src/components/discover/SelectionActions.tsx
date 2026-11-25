import { useState } from 'react';
import { Link } from 'react-router';
import { api, errorMessage } from '../../api/client';
import { useAuth } from '../../auth/AuthContext';
import { useAsync, useDepartments } from '../../hooks';
import type { ExternalAuthor, ScholarlyWork, User } from '../../types';
import { AlertCircleIcon, InfoIcon } from '../Icons';

interface Props {
  /** The works currently ticked. */
  selected: ScholarlyWork[];
  /** When viewing one researcher's profile: enables "send whole profile". */
  author?: ExternalAuthor;
  /** Other OpenAlex profiles of the same person that are merged into the view. */
  alsoAuthorIds?: string[];
  /** Papers on the profile(s) (main + merged), for the "whole profile" button. */
  profileWorksCount?: number;
  /** Ticked papers that are NOT on the profile(s): sent along with "whole profile". */
  selectedExtras?: ScholarlyWork[];
  onDone: () => void;
}

/** Same rule as the server: same family name, and same first name (or same initial if one is abbreviated). */
function looksLikeSamePerson(a: string, b: string): boolean {
  const titles = new Set(['dr', 'prof', 'professor', 'mr', 'mrs', 'ms', 'miss', 'er', 'sir', 'shri', 'smt']);
  const parts = (n: string) =>
    n
      .toLowerCase()
      .normalize('NFKD')
      .replace(/[^a-z\s]/g, ' ')
      .split(/\s+/)
      .filter((t) => t && !titles.has(t));
  const x = parts(a);
  const y = parts(b);
  if (x.length === 0 || y.length === 0 || x[x.length - 1] !== y[y.length - 1]) return false;
  if (x.length === 1 || y.length === 1) return true;
  const [fx, fy] = [x[0] as string, y[0] as string];
  return fx.length > 1 && fy.length > 1 ? fx === fy : fx[0] === fy[0];
}

const refOf = (w: ScholarlyWork) => ({ ...(w.openalexId ? { openalexId: w.openalexId } : {}), ...(w.doi ? { doi: w.doi } : {}) });

/**
 * What the user can do with search results:
 *  - Researcher: import the ticked papers into their own account.
 *  - Admin: send them (or the whole profile) to a registered researcher, who
 *    must approve before anything is added to their account.
 *  - Viewer: nothing (read-only).
 */
export function SelectionActions({ selected, author, alsoAuthorIds = [], profileWorksCount, selectedExtras = [], onDone }: Props) {
  const { user } = useAuth();
  const departments = useDepartments();
  const isAdmin = user?.role === 'ADMIN';
  const [departmentId, setDepartmentId] = useState('');
  const [researcherId, setResearcherId] = useState('');
  const [message, setMessage] = useState('');
  const [status, setStatus] = useState<{ kind: 'info' | 'error'; text: string; link?: string } | null>(null);
  const [busy, setBusy] = useState(false);

  const { data: researchers } = useAsync(
    () =>
      isAdmin
        ? api<{ items: User[] }>('/admin/users').then((r) => r.items.filter((u) => u.role === 'RESEARCHER' && u.active))
        : Promise.resolve([] as User[]),
    [isAdmin],
  );

  if (!user || user.role === 'VIEWER') return null;

  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    setStatus(null);
    try {
      await fn();
    } catch (err) {
      setStatus({ kind: 'error', text: errorMessage(err) });
    } finally {
      setBusy(false);
    }
  };

  if (!isAdmin) {
    const dept = departmentId || user.department?.id || '';
    return (
      <div className={`card action-bar${selected.length > 0 ? ' has-selection' : ''}`}>
        <span className="muted small grow-text">
          Import the ticked papers into <strong>your</strong> account. Only import papers you co-authored.
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
        <button
          className="btn primary"
          type="button"
          disabled={busy || selected.length === 0 || !dept}
          onClick={() =>
            void run(async () => {
              const res = await api<{ imported: unknown[]; skipped: { reason: string }[] }>('/discover/import', {
                method: 'POST',
                body: { works: selected.map(refOf), departmentId: dept },
              });
              setStatus({
                kind: 'info',
                text: `Imported ${res.imported.length} paper(s)${res.skipped.length ? `, skipped ${res.skipped.length} (${[...new Set(res.skipped.map((s) => s.reason))].join('; ')})` : ''}.`,
              });
              onDone();
            })
          }
        >
          Import selected ({selected.length})
        </button>
        {status && (
          <p className={`alert ${status.kind} full`}>
            {status.kind === 'error' ? <AlertCircleIcon size={16} /> : <InfoIcon size={16} />}
            <span>{status.text}</span>
          </p>
        )}
      </div>
    );
  }

  // Admin: suggest accounts whose name looks like the profile's name first.
  const suggested = author ? (researchers ?? []).filter((r) => looksLikeSamePerson(r.name, author.name)) : [];
  const others = (researchers ?? []).filter((r) => !suggested.includes(r));
  const send = (whole: boolean) =>
    run(async () => {
      const claim = await api<{ id: string; works: unknown[] }>('/claims', {
        method: 'POST',
        body: {
          researcherId,
          authorName: author?.name ?? 'Selected papers',
          ...(author ? { openalexAuthorId: author.id, authorInstitution: author.institutions[0] } : {}),
          ...(whole ? { wholeProfile: true, alsoAuthorIds } : {}),
          works: (whole ? selectedExtras : selected).map(refOf),
          ...(message.trim() ? { message: message.trim() } : {}),
        },
      });
      const name = researchers?.find((r) => r.id === researcherId)?.name ?? 'the researcher';
      setStatus({
        kind: 'info',
        text: `Request sent to ${name} with ${claim.works.length} paper(s). They will be notified to approve it.`,
        link: `/claims/${claim.id}`,
      });
      setMessage('');
      onDone();
    });

  return (
    <div className={`card action-bar${selected.length > 0 ? ' has-selection' : ''}`}>
      <label className="inline-label">
        Send to researcher
        <select value={researcherId} onChange={(e) => setResearcherId(e.target.value)}>
          <option value="">Choose a registered researcher…</option>
          {suggested.length > 0 && (
            <optgroup label="Name matches">
              {suggested.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.name} ({r.department?.code ?? 'no dept'})
                </option>
              ))}
            </optgroup>
          )}
          <optgroup label={suggested.length ? 'Everyone else' : 'Researchers'}>
            {others.map((r) => (
              <option key={r.id} value={r.id}>
                {r.name} ({r.department?.code ?? 'no dept'})
              </option>
            ))}
          </optgroup>
        </select>
      </label>
      <input
        className="grow-input"
        placeholder="Optional message, e.g. “Please confirm these are your papers”"
        maxLength={500}
        value={message}
        onChange={(e) => setMessage(e.target.value)}
        aria-label="Message to the researcher"
      />
      <button className="btn" type="button" disabled={busy || !researcherId || selected.length === 0} onClick={() => void send(false)}>
        Send selected ({selected.length})
      </button>
      {author && (
        <button className="btn primary" type="button" disabled={busy || !researcherId} onClick={() => void send(true)}>
          Send whole profile ({Math.min(profileWorksCount ?? author.worksCount, 200).toLocaleString()} papers
          {alsoAuthorIds.length > 0 && ` from ${alsoAuthorIds.length + 1} profiles`}
          {selectedExtras.length > 0 && ` + ${selectedExtras.length} ticked`})
        </button>
      )}
      <p className="muted small full">
        The researcher gets a notification, reviews the list and approves or rejects it. Nothing is added to their account without their approval.
      </p>
      {status && (
        <p className={`alert ${status.kind} full`}>
          {status.kind === 'error' ? <AlertCircleIcon size={16} /> : <InfoIcon size={16} />}
          <span>
            {status.text} {status.link && <Link to={status.link}>View request</Link>}
          </span>
        </p>
      )}
    </div>
  );
}
