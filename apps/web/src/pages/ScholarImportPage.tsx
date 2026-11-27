import { useState, type ChangeEvent } from 'react';
import { Link } from 'react-router';
import { api, errorMessage } from '../api/client';
import { useAuth } from '../auth/AuthContext';
import { AlertCircleIcon, ExternalLinkIcon, FileTextIcon, InfoIcon } from '../components/Icons';
import { useDepartments } from '../hooks';
import { typeLabel, type BibAnalysis, type BibCandidate } from '../types';

/** Same limit as the server; checked here first so a huge file is never sent. */
const MAX_BYTES = 1_000_000;

interface ImportResult {
  imported: { id: string; title: string }[];
  skipped: { index: number; title: string; reason: string }[];
}

const STATUS_LABEL: Record<BibCandidate['status'], string> = { new: 'New', duplicate: 'Already have', invalid: 'Cannot import' };

/**
 * Import publications from a BibTeX file, e.g. a researcher's own Google
 * Scholar profile export. Step 1 previews (nothing is saved); step 2 imports
 * the ticked entries. The server re-reads the file and checks everything again.
 */
export function ScholarImportPage() {
  const { user } = useAuth();
  const departments = useDepartments();
  const [fileName, setFileName] = useState('');
  const [text, setText] = useState<string | null>(null);
  const [analysis, setAnalysis] = useState<BibAnalysis | null>(null);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [departmentId, setDepartmentId] = useState(user?.department?.id ?? '');
  const [result, setResult] = useState<ImportResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const preview = async (bib: string) => {
    const res = await api<BibAnalysis>('/import/bibtex/preview', { method: 'POST', text: bib });
    setAnalysis(res);
    setSelected(new Set(res.candidates.filter((c) => c.status === 'new').map((c) => c.index)));
  };

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

  const onFile = (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = ''; // allow choosing the same file again
    if (!file) return;
    setResult(null);
    setAnalysis(null);
    if (file.size > MAX_BYTES) {
      setError('This file is larger than 1 MB. Export fewer papers at a time, or split the file.');
      return;
    }
    void run(async () => {
      const content = await file.text();
      setFileName(file.name);
      setText(content);
      await preview(content);
    });
  };

  const onImport = () =>
    void run(async () => {
      if (!text) return;
      const res = await api<ImportResult>('/import/bibtex', {
        method: 'POST',
        text,
        query: { select: [...selected].sort((a, b) => a - b).join(','), departmentId: departmentId || undefined },
      });
      setResult(res);
      await preview(text); // refresh: imported entries now show as "Already have"
    });

  const toggle = (index: number) =>
    setSelected((s) => {
      const next = new Set(s);
      if (next.has(index)) next.delete(index);
      else next.add(index);
      return next;
    });

  const importable = analysis?.candidates.filter((c) => c.status === 'new') ?? [];
  const allSelected = importable.length > 0 && importable.every((c) => selected.has(c.index));

  return (
    <section>
      <div className="page-head">
        <div className="page-title-group">
          <span className="eyebrow">External Sync</span>
          <h1>Import from Google Scholar</h1>
          <p className="page-subtitle">
            Bring in your full Google Scholar list, including papers that open databases do not have, by uploading a BibTeX export.
          </p>
        </div>
      </div>

      <div className="card">
        <h2 className="small-heading">How to export your Google Scholar profile</h2>
        <ol className="steps">
          <li>
            Open{' '}
            <a href="https://scholar.google.com/citations" target="_blank" rel="noopener noreferrer">
              your Google Scholar profile <ExternalLinkIcon size={11} />
            </a>{' '}
            and click <strong>Show more</strong> until all your papers are listed.
          </li>
          <li>
            Tick the box at the top of the list to <strong>select all</strong> papers.
          </li>
          <li>
            Click <strong>Export → BibTeX</strong>. Scholar opens the text in a new tab: save it with <strong>Ctrl+S</strong> as a <code>.bib</code> file.
          </li>
          <li>Choose that file below. Nothing is saved until you press Import.</li>
        </ol>
        <p className="muted small">BibTeX files from Zotero, Mendeley, Scopus or IEEE Xplore work too. Maximum 1 MB.</p>
        <label className="file-picker">
          <FileTextIcon size={15} />
          <span>{fileName ? `Choose another file (current: ${fileName})` : 'Choose a .bib file'}</span>
          <input type="file" accept=".bib,.bibtex,.txt,text/plain,application/x-bibtex" onChange={onFile} disabled={busy} aria-label="BibTeX file" />
        </label>
      </div>

      {error && (
        <p className="alert error" role="alert">
          <AlertCircleIcon size={16} />
          <span>{error}</span>
        </p>
      )}

      {result && (
        <p className="alert info" role="status">
          <InfoIcon size={16} />
          <span>
            Imported {result.imported.length} publication(s)
            {result.skipped.length > 0 && `, skipped ${result.skipped.length}`}. <Link to="/?mine=true">See my publications</Link>
          </span>
        </p>
      )}

      {analysis && (
        <>
          <div className="card">
            <p className="small">
              <strong>{analysis.stats.entries}</strong> entries read: <span className="tag tag-ok">{analysis.stats.new} new</span>{' '}
              <span className="tag">{analysis.stats.duplicate} already in your publications</span>{' '}
              <span className="tag tag-warn">{analysis.stats.invalid} cannot be imported</span>
            </p>
            {analysis.errors.length > 0 && (
              <details>
                <summary className="small">{analysis.errors.length} part(s) of the file could not be read</summary>
                <ul className="small">
                  {analysis.errors.slice(0, 20).map((e) => (
                    <li key={`${e.line}-${e.message}`}>
                      Line {e.line}: {e.message}
                    </li>
                  ))}
                </ul>
              </details>
            )}
          </div>

          <div className="card table-card">
            <div className="table-meta-bar">
              <button
                className="btn small ghost"
                type="button"
                disabled={importable.length === 0}
                onClick={() => setSelected(allSelected ? new Set() : new Set(importable.map((c) => c.index)))}
              >
                {allSelected ? 'Clear selection' : 'Select all new'}
              </button>
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
                <button className="btn primary" type="button" onClick={onImport} disabled={busy || selected.size === 0 || !departmentId}>
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
                    <th>Journal / conference</th>
                    <th className="num">Year</th>
                    <th>Type</th>
                    <th>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {analysis.candidates.map((c) => (
                    <tr key={c.index} className={c.status === 'new' ? '' : 'inactive'}>
                      <td>
                        <input
                          type="checkbox"
                          aria-label={`Select ${c.title || c.key}`}
                          checked={selected.has(c.index)}
                          disabled={c.status !== 'new'}
                          onChange={() => toggle(c.index)}
                        />
                      </td>
                      <td className="title-cell">
                        {/* React escapes all text: a title containing HTML is shown, never run. */}
                        <span className="pub-title">{c.title || <span className="muted">(no title)</span>}</span>
                        <span className="muted small">{c.authors.slice(0, 6).join(', ')}{c.authors.length > 6 && ` +${c.authors.length - 6} more`}</span>
                      </td>
                      <td>{c.venue ?? <span className="muted">—</span>}</td>
                      <td className="num">{c.year ?? <span className="muted">—</span>}</td>
                      <td>
                        <span className="tag">{typeLabel(c.type)}</span>
                      </td>
                      <td>
                        <span className={`tag ${c.status === 'new' ? 'tag-ok' : c.status === 'invalid' ? 'tag-warn' : ''}`}>{STATUS_LABEL[c.status]}</span>
                        {c.reason && <span className="muted small block">{c.reason}</span>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}
    </section>
  );
}
