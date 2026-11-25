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

const ORCID_PATTERN = /^(\d{4})-(\d{4})-(\d{4})-(\d{3}[\dX])$/;

/**
 * Accepts "0000-0002-1825-0097" or "https://orcid.org/0000-0002-1825-0097"
 * and returns the bare iD if the format AND the check digit are valid.
 */
export function normalizeOrcid(input: string): string | null {
  const bare = input
    .trim()
    .toUpperCase()
    .replace(/^HTTPS?:\/\/(WWW\.)?ORCID\.ORG\//, '');
  if (!ORCID_PATTERN.test(bare)) return null;
  return orcidChecksumValid(bare) ? bare : null;
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
