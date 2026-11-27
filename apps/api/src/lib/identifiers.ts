/**
 * Helpers for the two scholarly identifiers the app accepts: DOI and ORCID iD.
 *
 * SECURITY: these values are later placed inside URLs that our server calls
 * (Crossref / ORCID). Strict validation with an allow-list pattern means a
 * user cannot smuggle in "../", "?", "#" or another host name and make our
 * server request something we did not intend (Server-Side Request Forgery).
 */

// Pattern recommended by Crossref; matches ~99.3% of real DOIs.
const DOI_PATTERN = /^10\.\d{4,9}\/[-._;()/:A-Za-z0-9<>[\]]+$/;

/**
 * Accepts "10.1000/xyz", "doi:10.1000/xyz" or "https://doi.org/10.1000/xyz"
 * and returns the bare lowercase DOI, or null when it is not a valid DOI.
 * (DOIs are case-insensitive, so lowercasing lets us detect duplicates.)
 */
export function normalizeDoi(input: string): string | null {
  const trimmed = input
    .trim()
    .replace(/^https?:\/\/(dx\.)?doi\.org\//i, '')
    .replace(/^doi:\s*/i, '');
  if (trimmed.length > 200 || !DOI_PATTERN.test(trimmed)) return null;
  return trimmed.toLowerCase();
}

/**
 * Squeeze user input down to the 16 ORCID characters: drops the orcid.org
 * URL, spaces, and any kind of dash (people paste iDs with "–" or spaces).
 * Returns "0000-0002-1825-0097" format, or null if it is not ORCID-shaped.
 * The check digit is NOT verified here (see normalizeOrcid).
 */
export function orcidShape(input: string): string | null {
  const compact = input
    .trim()
    .toUpperCase()
    .replace(/^HTTPS?:\/\/(WWW\.)?ORCID\.ORG\//, '')
    .replace(/[\s\p{Pd}]/gu, ''); // \p{Pd} = any kind of dash
  if (!/^\d{15}[\dX]$/.test(compact)) return null;
  return `${compact.slice(0, 4)}-${compact.slice(4, 8)}-${compact.slice(8, 12)}-${compact.slice(12)}`;
}

/**
 * Accepts "0000-0002-1825-0097", "https://orcid.org/0000-0002-1825-0097" or
 * the same with spaces / other dashes, and returns the bare iD if the format
 * AND the check digit are valid (the last character may be X).
 */
export function normalizeOrcid(input: string): string | null {
  const bare = orcidShape(input);
  return bare && orcidChecksumValid(bare) ? bare : null;
}

/** ORCID check digit, ISO 7064 MOD 11-2 (as documented by ORCID). */
export function orcidChecksumValid(orcid: string): boolean {
  const digits = orcid.replace(/-/g, '');
  let total = 0;
  for (let i = 0; i < 15; i++) {
    total = (total + Number(digits[i])) * 2;
  }
  const result = (12 - (total % 11)) % 11;
  const expected = result === 10 ? 'X' : String(result);
  return digits[15] === expected;
}
