import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { api, errorMessage } from '../../api/client';
import { workKey, type ExternalAuthor, type ResearcherWorks } from '../../types';
import { Pager } from './Pager';
import { SelectionActions } from './SelectionActions';
import { EMPTY_WORK_FILTERS, WorkFilters, filterQuery, type WorkFilterValues } from './WorkFilters';
import { WorkList } from './WorkList';

const fmt = (n: number) => n.toLocaleString();

/** One researcher's papers (OpenAlex profile + extra Crossref matches), with filters and actions. */
export function AuthorWorks({ author, onBack }: { author: ExternalAuthor; onBack: () => void }) {
  const [form, setForm] = useState<WorkFilterValues>({ ...EMPTY_WORK_FILTERS, sort: 'newest' });
  const [filters, setFilters] = useState(form);
  const [page, setPage] = useState(1);
  const [reload, setReload] = useState(0);
  const [data, setData] = useState<ResearcherWorks | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<Set<string>>(new Set());

  useEffect(() => {
    let cancelled = false;
    api<ResearcherWorks>(`/discover/people/${author.id}/works`, { query: { ...filterQuery(filters), page } })
      .then(
        (r) => !cancelled && (setData(r), setError(null)),
        (err: unknown) => !cancelled && setError(errorMessage(err)),
      )
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [author.id, filters, page, reload]);

  const allWorks = useMemo(() => [...(data?.works ?? []), ...(data?.crossrefExtras ?? [])], [data]);
  const selectedWorks = allWorks.filter((w) => selected.has(workKey(w)));
  const selectable = allWorks.filter((w) => !w.alreadyImported);
  const toggle = (key: string) =>
    setSelected((s) => {
      const n = new Set(s);
      if (n.has(key)) n.delete(key);
      else n.add(key);
      return n;
    });

  const onFilter = (e: FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setPage(1);
    setSelected(new Set());
    setFilters(form);
  };

  const profile = data?.author ?? author;
  return (
    <>
      <div className="card author-head">
        <div>
          <h2>{profile.name}</h2>
          <p className="muted small">
            {profile.institutions.join('; ') || 'No institution on record'}
            {profile.orcidId && ` · ORCID ${profile.orcidId}`} · {fmt(profile.worksCount)} publications · {fmt(profile.citedByCount)} citations
          </p>
          {data?.linkedUser && <p className="small">Confirmed as the profile of <strong>{data.linkedUser.name}</strong>.</p>}
        </div>
        <button className="btn ghost" type="button" onClick={onBack}>
          ← Back to people
        </button>
      </div>

      <form className="card filters" onSubmit={onFilter} aria-label="Filter this researcher's papers">
        <WorkFilters value={form} onChange={setForm} showRelevance={false} />
        <div className="filter-buttons">
          <button className="btn primary" type="submit">
            Apply filters
          </button>
        </div>
      </form>

      <SelectionActions
        selected={selectedWorks}
        author={profile}
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
          <span className="muted small">{loading ? 'Loading…' : `${fmt(data?.total ?? 0)} paper(s) on OpenAlex`}</span>
          {selectable.length > 0 && (
            <button
              className="btn small ghost"
              type="button"
              onClick={() =>
                setSelected(selectedWorks.length === selectable.length ? new Set() : new Set(selectable.map(workKey)))
              }
            >
              {selectedWorks.length === selectable.length ? 'Clear selection' : 'Select all on this page'}
            </button>
          )}
        </div>
        {data && <WorkList works={data.works} selected={selected} onToggle={toggle} />}
        <Pager
          page={page}
          totalPages={data ? Math.min(200, Math.ceil(data.total / data.perPage)) : 1}
          disabled={loading}
          onPage={(p) => {
            setLoading(true);
            setPage(p);
          }}
        />
      </div>

      {data && data.crossrefExtras.length > 0 && (
        <div className="card table-card">
          <div className="list-head">
            <span className="small">
              <strong>Also on Crossref</strong>{' '}
              <span className="muted">
                · {data.crossrefExtras.length} paper(s) with the same name and institution that OpenAlex does not list on this profile
              </span>
            </span>
          </div>
          <WorkList works={data.crossrefExtras} selected={selected} onToggle={toggle} />
        </div>
      )}
    </>
  );
}
