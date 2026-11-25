import { useEffect, useState, type FormEvent } from 'react';
import { api, errorMessage } from '../../api/client';
import type { ExternalAuthor, PeopleResult } from '../../types';
import { Pager } from './Pager';

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

  useEffect(() => {
    if (!params) return;
    let cancelled = false;
    api<PeopleResult>('/discover/people', { query: { ...params, q: params.q.trim(), hasOrcid: params.hasOrcid } })
      .then(
        (r) => !cancelled && (setResult(r), setError(null)),
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
            Search
          </button>
        </div>
      </form>

      {error && (
        <p className="alert error" role="alert">
          {error}
        </p>
      )}

      <div className="card table-card">
        <p className="muted small">
          {loading ? 'Searching…' : result ? `${fmt(result.total)} researcher(s)` : 'Type a name to search.'}
        </p>
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
                      {a.linkedUser && <span className="tag tag-ok">Confirmed: {a.linkedUser.name}</span>}
                    </td>
                    <td>{a.institutions.join('; ') || '—'}</td>
                    <td className="nowrap">{a.orcidId ?? '—'}</td>
                    <td className="num">{fmt(a.worksCount)}</td>
                    <td className="num">{fmt(a.citedByCount)}</td>
                    <td>
                      <button className="btn small" type="button" onClick={() => onOpen(a)}>
                        View papers
                      </button>
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
