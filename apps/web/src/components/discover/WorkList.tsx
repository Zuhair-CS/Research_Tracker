import { typeLabel, workKey, type ScholarlyWork } from '../../types';
import { CheckIcon, ExternalLinkIcon, FileTextIcon } from '../Icons';

interface Props {
  works: ScholarlyWork[];
  selected?: Set<string>;
  onToggle?: (key: string) => void;
  /** Which works may be ticked (default: all not yet imported). */
  canSelect?: (w: ScholarlyWork) => boolean;
  emptyText?: string;
}

const fmt = (n: number) => n.toLocaleString();

/**
 * Google-Scholar-style result list: one entry per paper, with the sources it
 * was found in. Text is rendered by React (escaped), links are https only.
 */
export function WorkList({ works, selected, onToggle, canSelect = () => true, emptyText = 'No papers found.' }: Props) {
  if (works.length === 0) return <p className="muted empty-state">{emptyText}</p>;
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
                disabled={w.alreadyImported || !canSelect(w)}
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
                <span>{[w.venue, w.year, typeLabel(w.type)].filter(Boolean).join(' · ')}</span>
                <span>Cited by {fmt(w.citedByCount)}</span>
                {w.pdfUrl && (
                  <a className="link-pill" href={w.pdfUrl} target="_blank" rel="noopener noreferrer">
                    <FileTextIcon size={11} />
                    <span>PDF</span>
                    <ExternalLinkIcon size={10} />
                  </a>
                )}
                {w.openAccess && <span className="tag tag-ok">Open access</span>}
                {w.sources.map((s) => (
                  <span key={s} className={`tag source-${s}${s === 'openalex' ? ' tag-accent' : ''}`}>
                    {s === 'openalex' ? 'OpenAlex' : s === 'orcid' ? 'ORCID' : 'Crossref'}
                  </span>
                ))}
                {w.alreadyImported && (
                  <span className="tag tag-ok">
                    <CheckIcon size={11} />
                    <span>Imported</span>
                  </span>
                )}
                {w.matchNote && <span className="tag tag-warn">Unconfirmed: {w.matchNote}</span>}
              </div>
            </div>
          </li>
        );
      })}
    </ul>
  );
}
