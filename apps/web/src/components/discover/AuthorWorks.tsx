import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { api, errorMessage } from '../../api/client';
import { initialsOf } from '../../lib/format';
import { workKey, type ExternalAuthor, type RelatedProfile, type ResearcherWorks } from '../../types';
import { AlertCircleIcon, ArrowLeftIcon, CheckIcon, InfoIcon } from '../Icons';
import { Pager } from './Pager';
import { SelectionActions } from './SelectionActions';
import { EMPTY_WORK_FILTERS, WorkFilters, filterQuery, type WorkFilterValues } from './WorkFilters';
import { WorkList } from './WorkList';

const fmt = (n: number) => n.toLocaleString();

const REASON: Record<RelatedProfile['reason'], string> = {
  'same-orcid': 'Same ORCID iD',
  'same-name': 'Same name, same institution',
  'name-variant': 'Name spelled differently on papers from the same institution',
};

/**
 * One researcher's papers: their OpenAlex profile (plus any other profiles of
 * the same person the user ticks), confirmed Crossref extras, and unconfirmed
 * "possible matches", with filters and actions.
 */
export function AuthorWorks({ author, onBack }: { author: ExternalAuthor; onBack: () => void }) {
  const [form, setForm] = useState<WorkFilterValues>({ ...EMPTY_WORK_FILTERS, sort: 'newest' });
  const [filters, setFilters] = useState(form);
  const [page, setPage] = useState(1);
  const [reload, setReload] = useState(0);
  const [data, setData] = useState<ResearcherWorks | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [related, setRelated] = useState<RelatedProfile[] | null>(null);
  const [included, setIncluded] = useState<string[]>([]);

  // Other profiles that may be this person. A profile with the same ORCID iD is certain, so it is included straight away.
  useEffect(() => {
    let cancelled = false;
    api<{ profiles: RelatedProfile[] }>(`/discover/people/${author.id}/related`).then(
      (r) => {
        if (cancelled) return;
        setRelated(r.profiles);
        const sure = r.profiles.filter((p) => p.reason === 'same-orcid').map((p) => p.id);
        if (sure.length) {
          setLoading(true);
          setIncluded(sure);
        }
      },
      () => !cancelled && setRelated([]),
    );
    return () => {
      cancelled = true;
    };
  }, [author.id]);

  const also = included.join(',');
  useEffect(() => {
    let cancelled = false;
    api<ResearcherWorks>(`/discover/people/${author.id}/works`, { query: { ...filterQuery(filters), page, also } })
      .then(
        (r) => !cancelled && (setData(r), setError(null)),
        (err: unknown) => !cancelled && setError(errorMessage(err)),
      )
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [author.id, filters, page, reload, also]);

  const extras = useMemo(() => [...(data?.crossrefExtras ?? []), ...(data?.possibleMatches ?? [])], [data]);
  const allWorks = useMemo(() => [...(data?.works ?? []), ...extras], [data, extras]);
  const selectedWorks = allWorks.filter((w) => selected.has(workKey(w)));
  const selectedExtras = extras.filter((w) => selected.has(workKey(w)));
  // "Select all" only covers confirmed papers; possible matches are always ticked one by one.
  const confirmed = useMemo(() => [...(data?.works ?? []), ...(data?.crossrefExtras ?? [])], [data]);
  const selectable = confirmed.filter((w) => !w.alreadyImported);
  const allSelected = selectable.length > 0 && selectable.every((w) => selected.has(workKey(w)));
  const toggle = (key: string) =>
    setSelected((s) => {
      const n = new Set(s);
      if (n.has(key)) n.delete(key);
      else n.add(key);
      return n;
    });

  const restart = () => {
    setLoading(true);
    setPage(1);
    setSelected(new Set());
  };
  const onFilter = (e: FormEvent) => {
    e.preventDefault();
    restart();
    setFilters(form);
  };
  const toggleProfile = (id: string) => {
    restart();
    setIncluded((ids) => (ids.includes(id) ? ids.filter((x) => x !== id) : [...ids, id]));
  };

  const profile = data?.author ?? author;
  const includedProfiles = (related ?? []).filter((p) => included.includes(p.id));
  const profileWorksCount = profile.worksCount + includedProfiles.reduce((n, p) => n + p.worksCount, 0);

  return (
    <>
      <div className="card author-head">
        <div className="author-identity">
          <div className="author-avatar" aria-hidden="true">
            {initialsOf(profile.name, 'R')}
          </div>
          <div>
            <h2>{profile.name}</h2>
            <p className="muted small">{profile.institutions.join('; ') || 'No institution on record'}</p>
            <div className="author-stats">
              <span className="tag tag-accent">{fmt(profile.worksCount)} publications</span>
              <span className="tag">{fmt(profile.citedByCount)} citations</span>
              {profile.orcidId && <span className="tag tag-mono">ORCID {profile.orcidId}</span>}
              {data?.linkedUser && (
                <span className="tag tag-ok">
                  <CheckIcon size={11} />
                  <span>Confirmed: {data.linkedUser.name}</span>
                </span>
              )}
            </div>
          </div>
        </div>
        <button className="btn ghost" type="button" onClick={onBack}>
          <ArrowLeftIcon size={15} />
          <span>Back to people</span>
        </button>
      </div>

      {related && related.length > 0 && (
        <div className="card related-profiles">
          <p className="small">
            <strong>Other profiles that may be this person</strong>{' '}
            <span className="muted">
              · OpenAlex sometimes splits one researcher into several profiles (different spellings, or a change of institution). Tick the ones that
              are the same person to add their papers to the list.
            </span>
          </p>
          <ul>
            {related.map((p) => (
              <li key={p.id}>
                <label>
                  <input type="checkbox" checked={included.includes(p.id)} onChange={() => toggleProfile(p.id)} disabled={loading} />
                  <span>
                    <strong>{p.name}</strong> · {fmt(p.worksCount)} paper(s) · {p.institutions.join('; ') || 'no current institution'}
                    {p.orcidId && ` · ORCID ${p.orcidId}`}
                    <span className="tag">{REASON[p.reason]}</span>
                    {p.linkedUser && <span className="tag tag-warn">Confirmed by {p.linkedUser.name}</span>}
                  </span>
                </label>
              </li>
            ))}
          </ul>
        </div>
      )}

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
        alsoAuthorIds={included}
        profileWorksCount={profileWorksCount}
        selectedExtras={selectedExtras}
        onDone={() => {
          setSelected(new Set());
          setReload((r) => r + 1);
        }}
      />

      {error && (
        <p className="alert error" role="alert">
          <AlertCircleIcon size={16} />
          <span>{error}</span>
        </p>
      )}
      {data?.warnings.map((w) => (
        <p key={w} className="alert info">
          <InfoIcon size={16} />
          <span>{w}</span>
        </p>
      ))}

      <div className="card table-card">
        <div className="list-head">
          <span className="muted small">
            {loading
              ? 'Loading…'
              : `${fmt(data?.total ?? 0)} paper(s) on OpenAlex${included.length ? ` across ${included.length + 1} profiles` : ''}`}
          </span>
          {selectable.length > 0 && (
            <button
              className="btn small ghost"
              type="button"
              onClick={() =>
                setSelected((s) => {
                  const n = new Set(s);
                  for (const w of selectable) {
                    if (allSelected) n.delete(workKey(w));
                    else n.add(workKey(w));
                  }
                  return n;
                })
              }
            >
              {allSelected ? 'Clear selection' : 'Select all confirmed papers'}
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

      {data && data.possibleMatches.length > 0 && (
        <div className="card table-card possible-matches">
          <div className="list-head">
            <span className="small">
              <strong>Possible matches (not confirmed)</strong>{' '}
              <span className="muted">
                · {data.possibleMatches.length} paper(s) under the same name where the institution could not be checked. They may belong to someone
                else with the same name: open each one and tick only papers you are sure about.
              </span>
            </span>
          </div>
          <WorkList works={data.possibleMatches} selected={selected} onToggle={toggle} />
        </div>
      )}
    </>
  );
}
