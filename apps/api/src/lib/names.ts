/**
 * Person-name matching for scholarly data, where the same person appears as
 * "Ashok Pandey", "A. Pandey" or "Pandey, Ashok". Two names match when the
 * family names are equal and the first names agree: equal when both are
 * written out ("Ashok" = "Ashok"), or the same letter when one side is only an
 * initial ("A." = "Ashok").
 *
 * Used to drop fuzzy matches: a search for "Ashok Pandey" also returns papers
 * by "Shyam Pandey" and "Anil Pandey", which must not be offered as his.
 */

export function normalizeText(value: string): string {
  return value
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '') // strip accents: "José" -> "Jose"
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

interface NameParts {
  family: string;
  /** First given name ("ashok"), or just its initial ("a") if that is all we have. */
  first: string;
}

/** Titles that are not part of the name: "Dr. Gaurav Pandey" is "Gaurav Pandey". */
const HONORIFICS = new Set(['dr', 'prof', 'professor', 'mr', 'mrs', 'ms', 'miss', 'er', 'sir', 'shri', 'smt']);

export function nameParts(name: string): NameParts | null {
  const raw = name.includes(',') ? name.split(',').reverse().join(' ') : name; // "Pandey, Ashok"
  const tokens = normalizeText(raw)
    .split(' ')
    .filter((t) => t && !HONORIFICS.has(t));
  if (tokens.length === 0) return null;
  const family = tokens[tokens.length - 1] as string;
  const first = tokens.length > 1 ? (tokens[0] as string) : '';
  return { family, first };
}

export function namesMatch(a: string, b: string): boolean {
  const x = nameParts(a);
  const y = nameParts(b);
  if (!x || !y || x.family !== y.family) return false;
  // If either side has no first name, the family name alone has to do.
  if (!x.first || !y.first) return true;
  if (x.first.length > 1 && y.first.length > 1) return x.first === y.first;
  return x.first[0] === y.first[0];
}

/** Key used to spot the same paper from two sources when one has no DOI. */
export function titleKey(title: string, year: number | null): string {
  return `${normalizeText(title).slice(0, 120)}|${year ?? ''}`;
}
