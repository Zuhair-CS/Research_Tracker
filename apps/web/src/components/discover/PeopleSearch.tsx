import { useEffect, useState, type FormEvent } from 'react';
import { api, errorMessage } from '../../api/client';
import { workKey, type ExternalAuthor, type PeopleResult } from '../../types';
import { AlertCircleIcon, CheckIcon, SearchIcon } from '../Icons';
import { Pager } from './Pager';
import { SelectionActions } from './SelectionActions';
import { WorkList } from './WorkList';

interface Props {
  institution: string | null;
  onOpen: (author: ExternalAuthor) => void;
}

interface Params {
  q: string;
  scope: 'institution' | 'all';
  sort: 'relevance' | 'works' | 'citations';
  hasOrcid: boolean;
  page: number;
}

const fmt = (n: number) => n.toLocaleString();

/** People search. Opens on "everyone at our university" so faculty are visible straight away. */
export function PeopleSearch({ institution, onOpen }: Props) {
  const [form, setForm] = useState<Omit<Params, 'page'>>({ q: '', scope: institution ? 'institution' : 'all', sort: 'relevance', hasOrcid: false });
  const [params, setParams] = useState<Params | null>(institution ? { ...form, page: 1 } : null);
  const [result, setResult] = useState<PeopleResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(Boolean(params));
  const [picked, setPicked] = useState<Set<string>>(new Set());

  useEffect(() => {
    if (!params) return;
    let cancelled = false;
    api<PeopleResult>('/discover/people', { query: { ...params, q: params.q.trim(), hasOrcid: params.hasOrcid } })
      .then(
        (r) => !cancelled && (setResult(r), setError(null), setPicked(new Set())),
        (err: unknown) => !cancelled && setError(errorMessage(err)),
      )
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [params]);

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setParams({ ...form, page: 1 });
  };
  const set = <K extends keyof typeof form>(k: K, v: (typeof form)[K]) => setForm((f) => ({ ...f, [k]: v }));
  const totalPages = result ? Math.min(200, Math.ceil(result.total / result.perPage)) : 1;

  return (
    <>
      <form className="card filters" onSubmit={onSubmit} aria-label="Search researchers">
        <label className="grow">
          Name or ORCID iD
          <input
            value={form.q}
            onChange={(e) => set('q', e.target.value)}
            placeholder={form.scope === 'institution' ? 'Leave empty to list everyone' : 'e.g. Ashok Pandey or 0000-0002-…'}
            maxLength={100}
          />
        </label>
        <label>
          Where
          <select value={form.scope} onChange={(e) => set('scope', e.target.value as Params['scope'])}>
            {institution && <option value="institution">{institution}</option>}
            <option value="all">Anywhere</option>
          </select>
        </label>
        <label>
          Sort by
          <select value={form.sort} onChange={(e) => set('sort', e.target.value as Params['sort'])}>
            <option value="relevance">Best match</option>
            <option value="works">Most publications</option>
            <option value="citations">Most cited</option>
          </select>
        </label>
        <label className="check">
          <input type="checkbox" checked={form.hasOrcid} onChange={(e) => set('hasOrcid', e.target.checked)} /> Has ORCID iD
        </label>
        <div className="filter-buttons">
          <button className="btn primary" type="submit">
            <SearchIcon size={15} />
            <span>Search</span>
          </button>
        </div>
      </form>

      {error && (
        <p className="alert error" role="alert">
          <AlertCircleIcon size={16} />
          <span>{error}</span>
        </p>
      )}

      {!loading && result?.orcidRecord && (
        <OrcidRecordCard
          record={result.orcidRecord}
          picked={picked}
          onToggle={(key) =>
            setPicked((s) => {
              const n = new Set(s);
              if (n.has(key)) n.delete(key);
              else n.add(key);
              return n;
            })
          }
          onDone={() => {
            setPicked(new Set());
            setLoading(true);
            setParams((p) => (p ? { ...p } : p));
          }}
        />
      )}

      <div className="card table-card">
        <div className="table-meta-bar">
          <p className="muted small">
            {loading
              ? 'Searching…'
              : result?.orcidRecord
                ? `${fmt(result.total)} OpenAlex profile(s) with the same name`
                : result
                  ? `${fmt(result.total)} researcher(s)`
                  : 'Type a name to search.'}
          </p>
        </div>
        {result && result.authors.length > 0 && (
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Institution</th>
                  <th>ORCID</th>
                  <th className="num">Publications</th>
                  <th className="num">Citations</th>
                  <th aria-label="Actions" />
                </tr>
              </thead>
              <tbody>
                {result.authors.map((a) => (
                  <tr key={a.id}>
                    <td>
                      <span className="pub-title">{a.name}</span>
                      {a.linkedUser && (
                        <span className="tag tag-ok">
                          <CheckIcon size={11} />
                          <span>Confirmed: {a.linkedUser.name}</span>
                        </span>
                      )}
                    </td>
                    <td>{a.institutions.join('; ') || <span className="muted">—</span>}</td>
                    <td className="nowrap">
                      {a.orcidId ? <span className="tag tag-mono">{a.orcidId}</span> : <span className="muted">—</span>}
                    </td>
                    <td className="num">{fmt(a.worksCount)}</td>
                    <td className="num">{fmt(a.citedByCount)}</td>
                    <td>
                      <div className="row-actions">
                        <button className="btn small" type="button" onClick={() => onOpen(a)}>
                          View papers
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {params && result && (
          <Pager
            page={params.page}
            totalPages={totalPages}
            disabled={loading}
            onPage={(p) => {
              setLoading(true);
              setParams({ ...params, page: p });
            }}
          />
        )}
      </div>
    </>
  );
}

/**
 * Shown when an ORCID iD is searched that no OpenAlex profile is linked to:
 * the person's own ORCID record, whose papers can be imported or sent like
 * any other search result (those with a DOI; the DOI is how we fetch details).
 */
function OrcidRecordCard({
  record,
  picked,
  onToggle,
  onDone,
}: {
  record: NonNullable<PeopleResult['orcidRecord']>;
  picked: Set<string>;
  onToggle: (key: string) => void;
  onDone: () => void;
}) {
  const selected = record.works.filter((w) => picked.has(workKey(w)));
  const withDoi = record.works.filter((w) => w.doi).length;
  return (
    <>
      <div className="card">
        <p className="small">
          <strong>Found on ORCID: {record.name || 'name not public'}</strong> <span className="tag tag-mono">{record.orcidId}</span>
        </p>
        <p className="muted small">
          No OpenAlex profile is linked to this ORCID iD, so these are the papers the person lists on their ORCID record
          ({record.works.length}, of which {withDoi} have a DOI and can be imported). Any OpenAlex profiles with the same name
          are listed below.
        </p>
      </div>
      {record.works.length > 0 && (
        <>
          <SelectionActions selected={selected} personName={record.name} onDone={onDone} />
          <div className="card table-card">
            <WorkList works={record.works} selected={picked} onToggle={onToggle} canSelect={(w) => Boolean(w.doi)} />
          </div>
        </>
      )}
    </>
  );
}
