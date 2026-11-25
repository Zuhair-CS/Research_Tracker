import { useEffect, useState, type FormEvent } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { api, errorMessage } from '../api/client';
import { useAuth } from '../auth/AuthContext';
import { useDepartments } from '../hooks';
import { PUBLICATION_TYPES, type Publication, type PublicationDraft, type PublicationType } from '../types';

interface FormState {
  title: string;
  authors: string; // one author per line in the textarea
  venue: string;
  year: string;
  doi: string;
  type: PublicationType;
  departmentId: string;
  pdfUrl: string;
  source: 'MANUAL' | 'CROSSREF';
}

const EMPTY: FormState = {
  title: '',
  authors: '',
  venue: '',
  year: String(new Date().getFullYear()),
  doi: '',
  type: 'JOURNAL_ARTICLE',
  departmentId: '',
  pdfUrl: '',
  source: 'MANUAL',
};

export function PublicationFormPage() {
  const { id } = useParams();
  const isEdit = Boolean(id);
  const { user } = useAuth();
  const departments = useDepartments();
  const navigate = useNavigate();

  const [form, setForm] = useState<FormState>({ ...EMPTY, departmentId: user?.department?.id ?? '' });
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [lookingUp, setLookingUp] = useState(false);

  useEffect(() => {
    if (!id) return;
    api<Publication>(`/publications/${id}`)
      .then((p) =>
        setForm({
          title: p.title,
          authors: p.authors.join('\n'),
          venue: p.venue ?? '',
          year: String(p.year),
          doi: p.doi ?? '',
          type: p.type,
          departmentId: p.department.id,
          pdfUrl: p.pdfUrl ?? '',
          source: 'MANUAL',
        }),
      )
      .catch((err: unknown) => setError(errorMessage(err)));
  }, [id]);

  // If the user has no department, default to the first one in the list.
  const departmentId = form.departmentId || departments[0]?.id || '';

  const set = <K extends keyof FormState>(key: K, value: FormState[K]) => setForm((f) => ({ ...f, [key]: value }));

  const onLookup = async () => {
    if (!form.doi.trim()) return;
    setLookingUp(true);
    setError(null);
    setNotice(null);
    try {
      const { draft, alreadyAddedId } = await api<{ draft: PublicationDraft; alreadyAddedId: string | null }>(
        '/publications/lookup/doi',
        { query: { doi: form.doi.trim() } },
      );
      setForm((f) => ({
        ...f,
        title: draft.title || f.title,
        authors: draft.authors.length ? draft.authors.join('\n') : f.authors,
        venue: draft.venue ?? f.venue,
        year: draft.year ? String(draft.year) : f.year,
        doi: draft.doi,
        type: draft.type,
        pdfUrl: draft.pdfUrl ?? f.pdfUrl,
        source: 'CROSSREF',
      }));
      setNotice(
        alreadyAddedId
          ? 'Details filled in from Crossref - note: you have already added a publication with this DOI.'
          : 'Details filled in from Crossref. Please check them before saving.',
      );
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setLookingUp(false);
    }
  };

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const body = {
      title: form.title,
      authors: form.authors
        .split('\n')
        .map((a) => a.trim())
        .filter(Boolean),
      venue: form.venue || null,
      year: Number(form.year),
      doi: form.doi || null,
      type: form.type,
      departmentId,
      pdfUrl: form.pdfUrl || null,
      source: form.source,
    };
    try {
      if (isEdit) await api(`/publications/${id}`, { method: 'PUT', body });
      else await api('/publications', { method: 'POST', body });
      navigate('/?mine=true');
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="narrow-page">
      <div className="page-head">
        <h1>{isEdit ? 'Edit publication' : 'Add publication'}</h1>
      </div>
      <form className="card form" onSubmit={(e) => void onSubmit(e)}>
        {error && (
          <p className="alert error" role="alert">
            {error}
          </p>
        )}
        {notice && (
          <p className="alert info" role="status">
            {notice}
          </p>
        )}

        <label>
          DOI
          <span className="inline">
            <input
              name="doi"
              value={form.doi}
              onChange={(e) => set('doi', e.target.value)}
              placeholder="10.1038/nature12373 or https://doi.org/…"
              maxLength={250}
            />
            <button className="btn" type="button" onClick={() => void onLookup()} disabled={lookingUp || !form.doi.trim()}>
              {lookingUp ? 'Looking up…' : 'Auto-fill from DOI'}
            </button>
          </span>
        </label>

        <label>
          Title *
          <input name="title" required maxLength={500} value={form.title} onChange={(e) => set('title', e.target.value)} />
        </label>
        <label>
          Authors * <span className="muted small">(one per line)</span>
          <textarea name="authors" required rows={4} value={form.authors} onChange={(e) => set('authors', e.target.value)} />
        </label>
        <label>
          Journal / conference
          <input name="venue" maxLength={300} value={form.venue} onChange={(e) => set('venue', e.target.value)} />
        </label>
        <div className="row">
          <label>
            Year *
            <input
              name="year"
              type="number"
              required
              min={1900}
              max={new Date().getFullYear() + 1}
              value={form.year}
              onChange={(e) => set('year', e.target.value)}
            />
          </label>
          <label>
            Type *
            <select name="type" value={form.type} onChange={(e) => set('type', e.target.value as PublicationType)}>
              {PUBLICATION_TYPES.map((t) => (
                <option key={t.value} value={t.value}>
                  {t.label}
                </option>
              ))}
            </select>
          </label>
          <label>
            Department *
            <select name="departmentId" required value={departmentId} onChange={(e) => set('departmentId', e.target.value)}>
              {departments.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.name}
                </option>
              ))}
            </select>
          </label>
        </div>
        <label>
          PDF link <span className="muted small">(https:// only)</span>
          <input
            name="pdfUrl"
            type="url"
            pattern="https://.*"
            maxLength={2048}
            value={form.pdfUrl}
            onChange={(e) => set('pdfUrl', e.target.value)}
          />
        </label>

        <div className="form-actions">
          <Link className="btn ghost" to="/">
            Cancel
          </Link>
          <button className="btn primary" type="submit" disabled={busy}>
            {busy ? 'Saving…' : 'Save publication'}
          </button>
        </div>
      </form>
    </section>
  );
}
