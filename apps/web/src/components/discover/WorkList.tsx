import { typeLabel, workKey, type ScholarlyWork } from '../../types';

interface Props {
  works: ScholarlyWork[];
  selected?: Set<string>;
  onToggle?: (key: string) => void;
  emptyText?: string;
}

const fmt = (n: number) => n.toLocaleString();

/**
 * Google-Scholar-style result list: one entry per paper, with the sources it
 * was found in. Text is rendered by React (escaped), links are https only.
 */
export function WorkList({ works, selected, onToggle, emptyText = 'No papers found.' }: Props) {
  if (works.length === 0) return <p className="muted pad">{emptyText}</p>;
  return (
    <ul className="work-list">
      {works.map((w) => {
        const key = workKey(w);
        return (
          <li key={key} className={w.alreadyImported ? 'is-imported' : ''}>
            {onToggle && (
              <input
                type="checkbox"
                aria-label={`Select ${w.title}`}
                checked={selected?.has(key) ?? false}
                disabled={w.alreadyImported}
                onChange={() => onToggle(key)}
              />
            )}
            <div className="work-body">
              <div className="work-title">
                {w.doi ? (
                  <a href={`https://doi.org/${encodeURI(w.doi)}`} target="_blank" rel="noopener noreferrer">
                    {w.title || '(no title)'}
                  </a>
                ) : (
                  w.title || '(no title)'
                )}
              </div>
              <div className="work-authors">
                {w.authors.slice(0, 8).join(', ')}
                {w.authors.length > 8 && ` +${w.authors.length - 8} more`}
              </div>
              <div className="work-meta">
                {[w.venue, w.year, typeLabel(w.type)].filter(Boolean).join(' · ')}
                <span>Cited by {fmt(w.citedByCount)}</span>
                {w.pdfUrl && (
                  <a href={w.pdfUrl} target="_blank" rel="noopener noreferrer">
                    PDF
                  </a>
                )}
                {w.openAccess && <span className="tag">Open access</span>}
                {w.sources.map((s) => (
                  <span key={s} className={`tag source-${s}`}>
                    {s === 'openalex' ? 'OpenAlex' : 'Crossref'}
                  </span>
                ))}
                {w.alreadyImported && <span className="tag tag-ok">Imported</span>}
                {w.matchNote && <span className="tag tag-warn">Unconfirmed: {w.matchNote}</span>}
              </div>
            </div>
          </li>
        );
      })}
    </ul>
  );
}
