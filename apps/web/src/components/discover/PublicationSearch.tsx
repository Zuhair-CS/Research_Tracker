import { useEffect, useState, type FormEvent } from 'react';
import { api, errorMessage } from '../../api/client';
import { workKey, type PublicationResults } from '../../types';
import { Pager } from './Pager';
import { SelectionActions } from './SelectionActions';
import { EMPTY_WORK_FILTERS, WorkFilters, filterQuery, type WorkFilterValues } from './WorkFilters';
import { WorkList } from './WorkList';

interface Form extends WorkFilterValues {
  q: string;
  author: string;
  scope: 'institution' | 'all';
  sources: 'both' | 'openalex' | 'crossref';
}

const fmt = (n: number) => n.toLocaleString();

/** Google-Scholar-style search over OpenAlex + Crossref, merged into one de-duplicated list. */
export function PublicationSearch({ institution }: { institution: string | null }) {
  const [form, setForm] = useState<Form>({
    ...EMPTY_WORK_FILTERS,
    q: '',
    author: '',
    scope: institution ? 'institution' : 'all',
    sources: 'both',
  });
  const [params, setParams] = useState<(Form & { page: number }) | null>(institution ? { ...form, page: 1 } : null);
  const [data, setData] = useState<PublicationResults | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(Boolean(params));
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [reload, setReload] = useState(0);

  useEffect(() => {
    if (!params) return;
    let cancelled = false;
    api<PublicationResults>('/discover/works', {
      query: {
        q: params.q.trim() || undefined,
        author: params.author.trim() || undefined,
        scope: params.scope,
        sources: params.sources,
        page: params.page,
        ...filterQuery(params),
      },
    })
      .then(
        (r) => !cancelled && (setData(r), setError(null)),
        (err: unknown) => !cancelled && setError(errorMessage(err)),
      )
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [params, reload]);

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setSelected(new Set());
    setParams({ ...form, page: 1 });
  };
  const set = <K extends keyof Form>(k: K, v: Form[K]) => setForm((f) => ({ ...f, [k]: v }));
  const works = data?.works ?? [];
  const selectedWorks = works.filter((w) => selected.has(workKey(w)));
  const biggest = data ? Math.max(data.totals.openalex, data.totals.crossref) : 0;
  const totalPages = Math.min(200, Math.ceil(biggest / (data?.perPage ?? 20)));

  return (
    <>
      <form className="card filters" onSubmit={onSubmit} aria-label="Search publications">
        <label className="grow">
          Keywords or title
          <input value={form.q} onChange={(e) => set('q', e.target.value)} placeholder="e.g. biofuel, machine learning" maxLength={200} />
        </label>
        <label>
          Author
          <input value={form.author} onChange={(e) => set('author', e.target.value)} placeholder="e.g. Ashok Pandey" maxLength={100} />
        </label>
        <label>
          Where
          <select value={form.scope} onChange={(e) => set('scope', e.target.value as Form['scope'])}>
            {institution && <option value="institution">{institution}</option>}
            <option value="all">Anywhere</option>
          </select>
        </label>
        <WorkFilters value={form} onChange={(f) => setForm((cur) => ({ ...cur, ...f }))} />
        <label>
          Sources
          <select value={form.sources} onChange={(e) => set('sources', e.target.value as Form['sources'])}>
            <option value="both">OpenAlex + Crossref</option>
            <option value="openalex">OpenAlex only</option>
            <option value="crossref">Crossref only</option>
          </select>
        </label>
        <div className="filter-buttons">
          <button className="btn primary" type="submit">
            Search
          </button>
        </div>
      </form>

      <SelectionActions
        selected={selectedWorks}
        onDone={() => {
          setSelected(new Set());
          setReload((r) => r + 1);
        }}
      />

      {error && (
        <p className="alert error" role="alert">
          {error}
        </p>
      )}
      {data?.warnings.map((w) => (
        <p key={w} className="alert info">
          {w}
        </p>
      ))}

      <div className="card table-card">
        <div className="list-head">
          <span className="muted small">
            {loading
              ? 'Searching…'
              : data
                ? `About ${fmt(data.totals.openalex)} on OpenAlex and ${fmt(data.totals.crossref)} on Crossref · duplicates merged`
                : 'Type keywords or an author to search.'}
          </span>
        </div>
        {data && (
          <WorkList
            works={works}
            selected={selected}
            onToggle={(key) =>
              setSelected((s) => {
                const n = new Set(s);
                if (n.has(key)) n.delete(key);
                else n.add(key);
                return n;
              })
            }
          />
        )}
        {params && data && (
          <Pager
            page={params.page}
            totalPages={totalPages}
            disabled={loading}
            onPage={(p) => {
              setLoading(true);
              setSelected(new Set());
              setParams({ ...params, page: p });
            }}
          />
        )}
      </div>
    </>
  );
}
