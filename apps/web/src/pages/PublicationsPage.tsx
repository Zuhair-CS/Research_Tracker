import { useState, type FormEvent } from 'react';
import { Link, useSearchParams } from 'react-router';
import { api, errorMessage, toQueryString } from '../api/client';
import { useAuth } from '../auth/AuthContext';
import {
  AlertCircleIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  DownloadIcon,
  ExternalLinkIcon,
  FileTextIcon,
  PlusCircleIcon,
  SearchIcon,
} from '../components/Icons';
import { useAsync, useDepartments } from '../hooks';
import { PUBLICATION_TYPES, typeLabel, type Page, type Publication } from '../types';

const FILTER_KEYS = ['q', 'author', 'departmentId', 'type', 'yearFrom', 'yearTo', 'mine', 'sort'] as const;

export function PublicationsPage() {
  const { user } = useAuth();
  const departments = useDepartments();
  const [params, setParams] = useSearchParams();
  const [actionError, setActionError] = useState<string | null>(null);

  // The filters live in the URL, so a search can be bookmarked or shared.
  const filters = Object.fromEntries(FILTER_KEYS.map((k) => [k, params.get(k) ?? ''])) as Record<(typeof FILTER_KEYS)[number], string>;
  const page = Number(params.get('page') ?? '1') || 1;
  const activeFilterCount = FILTER_KEYS.filter((k) => k !== 'sort' && Boolean(filters[k])).length;

  const { data, error, loading, reload } = useAsync(
    () => api<Page<Publication>>('/publications', { query: { ...filters, page, pageSize: 20 } }),
    [params.toString()],
  );

  const onSearch = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    const next = new URLSearchParams();
    for (const key of FILTER_KEYS) {
      const value = form.get(key);
      if (typeof value === 'string' && value.trim()) next.set(key, value.trim());
    }
    setParams(next);
  };

  const goToPage = (p: number) => {
    const next = new URLSearchParams(params);
    next.set('page', String(p));
    setParams(next);
  };

  const onDelete = async (pub: Publication) => {
    if (!window.confirm(`Delete "${pub.title}"? This cannot be undone.`)) return;
    setActionError(null);
    try {
      await api(`/publications/${pub.id}`, { method: 'DELETE' });
      await reload();
    } catch (err) {
      setActionError(errorMessage(err));
    }
  };

  const exportHref = `/api/reports/publications.csv${toQueryString(filters)}`;
  const totalPages = data ? Math.max(1, Math.ceil(data.total / data.pageSize)) : 1;

  return (
    <section>
      <div className="page-head">
        <div className="page-title-group">
          <span className="eyebrow">Institutional Repository</span>
          <h1>Publications</h1>
          <p className="page-subtitle">Browse, filter, and export verified departmental research output.</p>
        </div>
        <div className="actions">
          {/* A plain link: the browser sends the session cookie and downloads the file. */}
          <a className="btn" href={exportHref} download data-testid="export-csv">
            <DownloadIcon size={15} />
            <span>Export CSV</span>
          </a>
          {user?.role === 'RESEARCHER' && (
            <Link className="btn primary" to="/publications/new">
              <PlusCircleIcon size={15} />
              <span>Add publication</span>
            </Link>
          )}
        </div>
      </div>

      <form className="card filters" onSubmit={onSearch} key={params.toString()} aria-label="Search and filter">
        <label className="grow">
          Keyword
          <input name="q" type="search" placeholder="Title, venue, DOI or author" defaultValue={filters.q} maxLength={200} />
        </label>
        <label>
          Author
          <input name="author" placeholder="e.g. Rahman" defaultValue={filters.author} maxLength={200} />
        </label>
        <label>
          Department
          <select name="departmentId" defaultValue={filters.departmentId}>
            <option value="">All</option>
            {departments.map((d) => (
              <option key={d.id} value={d.id}>
                {d.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          Type
          <select name="type" defaultValue={filters.type}>
            <option value="">All</option>
            {PUBLICATION_TYPES.map((t) => (
              <option key={t.value} value={t.value}>
                {t.label}
              </option>
            ))}
          </select>
        </label>
        <label className="narrow">
          From year
          <input name="yearFrom" type="number" min={1900} max={3000} defaultValue={filters.yearFrom} />
        </label>
        <label className="narrow">
          To year
          <input name="yearTo" type="number" min={1900} max={3000} defaultValue={filters.yearTo} />
        </label>
        <label>
          Sort
          <select name="sort" defaultValue={filters.sort}>
            <option value="">Newest year</option>
            <option value="year_asc">Oldest year</option>
            <option value="title_asc">Title A–Z</option>
            <option value="created_desc">Recently added</option>
          </select>
        </label>
        {user?.role === 'RESEARCHER' && (
          <label className="check">
            <input type="checkbox" name="mine" value="true" defaultChecked={filters.mine === 'true'} /> Only mine
          </label>
        )}
        <div className="filter-buttons">
          <button className="btn primary" type="submit">
            <SearchIcon size={15} />
            <span>Search</span>
          </button>
          <button className="btn ghost" type="button" onClick={() => setParams(new URLSearchParams())}>
            Clear
          </button>
        </div>
      </form>

      {(error || actionError) && (
        <p className="alert error" role="alert">
          <AlertCircleIcon size={16} />
          <span>{error ?? actionError}</span>
        </p>
      )}

      <div className="card table-card">
        <div className="table-meta-bar">
          <p className="muted small">
            {loading ? 'Loading…' : `${data?.total ?? 0} publication(s)`}
            {activeFilterCount > 0 && ` · ${activeFilterCount} filter${activeFilterCount > 1 ? 's' : ''} active`}
          </p>
          {totalPages > 1 && (
            <span className="muted small">
              Page {page} of {totalPages}
            </span>
          )}
        </div>
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th>Title</th>
                <th>Authors</th>
                <th>Journal / conference</th>
                <th className="num">Year</th>
                <th>Type</th>
                <th>Department</th>
                <th>Added by</th>
                <th aria-label="Actions" />
              </tr>
            </thead>
            <tbody>
              {data?.items.map((p) => (
                <tr key={p.id}>
                  <td className="title-cell">
                    {/* React escapes all text, so a title containing <script> is shown, never run. */}
                    <span className="pub-title">{p.title}</span>
                    {(p.doi || p.pdfUrl) && (
                      <span className="links">
                        {p.doi && (
                          <a className="link-pill mono" href={`https://doi.org/${encodeURI(p.doi)}`} target="_blank" rel="noopener noreferrer">
                            <span>DOI {p.doi}</span>
                            <ExternalLinkIcon size={11} />
                          </a>
                        )}
                        {p.pdfUrl && (
                          <a className="link-pill" href={p.pdfUrl} target="_blank" rel="noopener noreferrer">
                            <FileTextIcon size={11} />
                            <span>PDF</span>
                          </a>
                        )}
                      </span>
                    )}
                  </td>
                  <td>{p.authors.join(', ')}</td>
                  <td>{p.venue ?? <span className="muted">—</span>}</td>
                  <td className="num">{p.year}</td>
                  <td>
                    <span className="tag">{typeLabel(p.type)}</span>
                  </td>
                  <td>
                    <span className="tag tag-mono">{p.department.code}</span>
                  </td>
                  <td className="nowrap">{p.owner.name}</td>
                  <td>
                    <div className="row-actions">
                      {p.canEdit && (
                        <>
                          <Link className="btn small" to={`/publications/${p.id}/edit`}>
                            Edit
                          </Link>
                          <button className="btn small danger" type="button" onClick={() => void onDelete(p)}>
                            Delete
                          </button>
                        </>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
              {data && data.items.length === 0 && (
                <tr>
                  <td colSpan={8} className="empty-state">
                    No publications match these filters.
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
              <button className="btn small" type="button" disabled={page <= 1} onClick={() => goToPage(page - 1)}>
                <ChevronLeftIcon size={14} />
                <span>Previous</span>
              </button>
              <button className="btn small" type="button" disabled={page >= totalPages} onClick={() => goToPage(page + 1)}>
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
