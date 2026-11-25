import { PUBLICATION_TYPES, type PublicationType } from '../../types';

export interface WorkFilterValues {
  yearFrom: string;
  yearTo: string;
  type: PublicationType | '';
  oaOnly: boolean;
  sort: 'relevance' | 'newest' | 'citations';
}

export const EMPTY_WORK_FILTERS: WorkFilterValues = { yearFrom: '', yearTo: '', type: '', oaOnly: false, sort: 'relevance' };

/** Year range, type, open access and sort - shared by the publication and profile views. */
export function WorkFilters({
  value,
  onChange,
  showRelevance = true,
}: {
  value: WorkFilterValues;
  onChange: (v: WorkFilterValues) => void;
  showRelevance?: boolean;
}) {
  const set = <K extends keyof WorkFilterValues>(k: K, v: WorkFilterValues[K]) => onChange({ ...value, [k]: v });
  return (
    <>
      <label className="narrow">
        From year
        <input type="number" min={1900} max={2100} value={value.yearFrom} onChange={(e) => set('yearFrom', e.target.value)} />
      </label>
      <label className="narrow">
        To year
        <input type="number" min={1900} max={2100} value={value.yearTo} onChange={(e) => set('yearTo', e.target.value)} />
      </label>
      <label>
        Type
        <select value={value.type} onChange={(e) => set('type', e.target.value as WorkFilterValues['type'])}>
          <option value="">Any type</option>
          {PUBLICATION_TYPES.filter((t) => t.value !== 'OTHER').map((t) => (
            <option key={t.value} value={t.value}>
              {t.label}
            </option>
          ))}
        </select>
      </label>
      <label>
        Sort by
        <select value={value.sort} onChange={(e) => set('sort', e.target.value as WorkFilterValues['sort'])}>
          {showRelevance && <option value="relevance">Best match</option>}
          <option value="newest">Newest first</option>
          <option value="citations">Most cited</option>
        </select>
      </label>
      <label className="check">
        <input type="checkbox" checked={value.oaOnly} onChange={(e) => set('oaOnly', e.target.checked)} /> Open access only
      </label>
    </>
  );
}

export const filterQuery = (f: WorkFilterValues) => ({
  yearFrom: f.yearFrom || undefined,
  yearTo: f.yearTo || undefined,
  type: f.type || undefined,
  oaOnly: f.oaOnly,
  sort: f.sort,
});
