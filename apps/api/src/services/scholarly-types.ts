import type { PublicationType } from '../generated/prisma/enums.js';

/** A publication found in an external catalogue (OpenAlex, Crossref, or both after merging). */
export interface ScholarlyWork {
  openalexId: string | null;
  doi: string | null;
  title: string;
  authors: string[];
  venue: string | null;
  year: number | null;
  type: PublicationType;
  pdfUrl: string | null;
  citedByCount: number;
  openAccess: boolean;
  sources: ('openalex' | 'crossref' | 'orcid')[];
  /** Set on "possible matches": why the paper is offered but not confirmed. */
  matchNote?: string;
}

export interface WorkFilters {
  yearFrom?: number;
  yearTo?: number;
  type?: PublicationType;
  openAccessOnly?: boolean;
  sort?: 'relevance' | 'newest' | 'citations';
}

/** Reference to a work to import: an OpenAlex id, or a DOI (looked up in Crossref). */
export interface WorkRef {
  openalexId?: string;
  doi?: string;
}
