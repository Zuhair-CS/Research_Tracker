import { beforeEach, describe, expect, it } from 'vitest';
import { CROSSREF, OPENALEX, ORCID, crossrefItem, crossrefList, installFakeApis, oaAuthor, oaList, oaWork, when } from '../helpers/fake-apis.js';
import { lookupDoi, mapCrossrefType, mapCrossrefWork, searchCrossref } from '../../src/services/crossref.js';
import { apiUrl, fetchJson, plainText } from '../../src/services/http-client.js';
import {
  findRelatedAuthors,
  getAuthorWorks,
  getInstitutionName,
  getWorksByIds,
  mapAuthor,
  mapOpenAlexType,
  mapWork,
  searchAuthors,
  searchWorks,
} from '../../src/services/openalex.js';
import { fetchWorkDetails, fetchWorkSummaries, mapBulkWorks, mapOrcidType, mapWorksSummary } from '../../src/services/orcid.js';
import { affiliationMatches, mergeWorks } from '../../src/services/scholarly-search.js';
import type { ScholarlyWork } from '../../src/services/scholarly-types.js';

const apis = installFakeApis();
beforeEach(() => apis.reset());

describe('http client (SSRF / DoS defences)', () => {
  const url = new URL('https://api.crossref.org/works/x');

  it('refuses redirects, sets a timeout and returns parsed JSON', async () => {
    let init: RequestInit | undefined;
    apis.on((u, i) => {
      init = i;
      return u.host === CROSSREF ? { body: { ok: true } } : undefined;
    });
    expect(await fetchJson(url, { 'User-Agent': 'test' })).toEqual({ status: 200, body: { ok: true } });
    expect(init?.redirect).toBe('error');
    expect(init?.signal).toBeInstanceOf(AbortSignal);
    expect((init?.headers as Record<string, string>).Accept).toBe('application/json');
  });

  it.each([
    [{ status: 404 }, { status: 404, body: null }],
    [{ status: 429 }, 'limiting requests'],
    [{ status: 503 }, 'returned an error (503)'],
    [{ text: 'not json' }, 'invalid JSON'],
    [{ text: 'x'.repeat(5 * 1024 * 1024 + 1) }, 'too large'],
    [{ throws: new Error('getaddrinfo ENOTFOUND') }, 'Could not reach api.crossref.org'],
  ])('handles %o', async (reply, expected) => {
    apis.on(when(CROSSREF, '/', reply));
    if (typeof expected === 'string') await expect(fetchJson(url, {})).rejects.toThrow(expected);
    else expect(await fetchJson(url, {})).toEqual(expected);
  });

  it('mentions the API key setting only for OpenAlex rate limits', async () => {
    apis.on(when(OPENALEX, '/', { status: 429 }));
    await expect(fetchJson(new URL('https://api.openalex.org/works'), {})).rejects.toThrow('OPENALEX_API_KEY');
  });

  it('encodes every path segment so input cannot escape it', () => {
    expect(apiUrl('https://api.crossref.org/', 'works', '10.1/../../admin?x=1#y').href).toBe(
      'https://api.crossref.org/works/10.1%2F..%2F..%2Fadmin%3Fx%3D1%23y',
    );
  });

  it('strips markup from titles', () => {
    expect(plainText('  CO<sub>2</sub> &amp; <i>H&lt;2&gt;</i> &quot;x&quot; &#39;y&#39;  ')).toBe('CO2 & H<2> "x" \'y\'');
  });
});

describe('Crossref client', () => {
  it.each([
    ['journal-article', 'JOURNAL_ARTICLE'],
    ['proceedings-article', 'CONFERENCE_PAPER'],
    ['book', 'BOOK'],
    ['monograph', 'BOOK'],
    ['edited-book', 'BOOK'],
    ['book-chapter', 'BOOK_CHAPTER'],
    ['book-section', 'BOOK_CHAPTER'],
    ['dissertation', 'THESIS'],
    ['posted-content', 'PREPRINT'],
    ['dataset', 'OTHER'],
    [null, 'OTHER'],
  ])('maps type %s -> %s', (type, expected) => {
    expect(mapCrossrefType(type)).toBe(expected);
  });

  it('maps a sparse record safely: no title, org author, only "published" date, non-https PDF', () => {
    const draft = mapCrossrefWork({
      message: {
        DOI: '10.5555/ABC',
        author: [{ name: 'The <b>Consortium</b>' }, { given: '', family: '' }],
        published: { 'date-parts': [[2019]] },
        link: [{ URL: 'http://insecure.example/a.pdf', 'content-type': 'application/pdf' }],
      },
    });
    expect(draft).toEqual({ title: '', authors: ['The Consortium'], venue: null, year: 2019, doi: '10.5555/abc', type: 'OTHER', pdfUrl: null });
  });

  it('throws 404 for an unknown DOI', async () => {
    apis.on(when(CROSSREF, '/works/', { status: 404 }));
    await expect(lookupDoi('10.5555/none')).rejects.toMatchObject({ status: 404 });
  });

  it('builds the search query with filters, sort and paging', async () => {
    apis.on(when(CROSSREF, '/works', { body: crossrefList([crossrefItem({ DOI: '10.5555/S' })], 7) }));
    const res = await searchCrossref({ q: 'crops', author: 'A. Rahman', affiliation: 'UPES', yearFrom: 2020, yearTo: 2022, type: 'BOOK', sort: 'newest', offset: 20_000, rows: 40 });
    expect(res.total).toBe(7);
    expect(res.works[0]).toMatchObject({ doi: '10.5555/s', affiliations: ['University of Petroleum and Energy Studies'], sources: ['crossref'] });
    const p = apis.calls[0]?.searchParams;
    expect(Object.fromEntries(p ?? [])).toMatchObject({
      'query.bibliographic': 'crops',
      'query.author': 'A. Rahman',
      'query.affiliation': 'UPES',
      filter: 'from-pub-date:2020,until-pub-date:2022,type:book,type:monograph,type:edited-book',
      sort: 'published',
      order: 'desc',
      rows: '40',
      offset: '9000', // Crossref caps deep paging
    });
    await searchCrossref({ sort: 'citations', type: 'OTHER', offset: 0, rows: 1 });
    expect(apis.calls[1]?.searchParams.get('sort')).toBe('is-referenced-by-count');
    expect(apis.calls[1]?.searchParams.has('filter')).toBe(false);
  });
});

describe('OpenAlex client', () => {
  it.each([
    ['article', 'journal', 'JOURNAL_ARTICLE'],
    ['review', null, 'JOURNAL_ARTICLE'],
    ['article', 'conference', 'CONFERENCE_PAPER'],
    ['book', null, 'BOOK'],
    ['book-chapter', null, 'BOOK_CHAPTER'],
    ['dissertation', null, 'THESIS'],
    ['preprint', null, 'PREPRINT'],
    ['dataset', null, 'OTHER'],
  ])('maps type %s (source %s) -> %s', (type, source, expected) => {
    expect(mapOpenAlexType(type, source)).toBe(expected);
  });

  it('maps authors and works, keeping only https PDF links', () => {
    expect(mapAuthor(oaAuthor('A1234', 'X', { orcid: 'https://orcid.org/0000-0002-1825-0097', last_known_institutions: null, works_count: null }))).toEqual({
      id: 'A1234', name: 'X', orcidId: '0000-0002-1825-0097', worksCount: 0, citedByCount: 100, institutions: [], institutionIds: [],
    });
    const w = mapWork(oaWork('W1', 'T', { doi: 'https://doi.org/10.5555/T', best_oa_location: { pdf_url: 'http://x/a.pdf' }, title: null, authorships: null, open_access: null }));
    expect(w).toMatchObject({ openalexId: 'W1', doi: '10.5555/t', title: 'T', authors: [], pdfUrl: null, openAccess: false });
  });

  it('sends the API key and contact e-mail only when configured', async () => {
    apis.on(when(OPENALEX, '/authors', { body: oaList([], 0) }));
    await searchAuthors({ q: 'x', onlyOurInstitution: false, hasOrcid: false, sort: 'works', page: 1, perPage: 5 });
    expect(apis.calls[0]?.searchParams.has('api_key')).toBe(false);
    expect(apis.calls[0]?.searchParams.has('mailto')).toBe(false);
    expect(apis.calls[0]?.searchParams.get('sort')).toBe('works_count:desc');
  });

  it.each([
    [{ type: 'JOURNAL_ARTICLE' }, 'type:article|review|letter|editorial,primary_location.source.type:!conference'],
    [{ type: 'CONFERENCE_PAPER' }, 'type:article,primary_location.source.type:conference'],
    [{ type: 'BOOK' }, 'type:book'],
    [{ type: 'BOOK_CHAPTER' }, 'type:book-chapter'],
    [{ type: 'THESIS' }, 'type:dissertation'],
    [{ type: 'PREPRINT' }, 'type:preprint'],
    [{ type: 'OTHER' }, ''],
    [{ yearFrom: 2020 }, 'publication_year:>2019'],
    [{ yearTo: 2020 }, 'publication_year:<2021'],
    [{ openAccessOnly: true }, 'open_access.is_oa:true'],
  ] as const)('author works filter %o', async (filters, expected) => {
    apis.on(when(OPENALEX, '/works', { body: oaList([]) }));
    await getAuthorWorks(['A1234'], filters, 1);
    expect(apis.calls[0]?.searchParams.get('filter')).toBe(['author.id:A1234', expected].filter(Boolean).join(','));
  });

  it('never puts unvalidated ids into a filter', async () => {
    await expect(getAuthorWorks([], {}, 1)).rejects.toThrow('Invalid');
    await expect(getAuthorWorks(['A1234|W1'], {}, 1)).rejects.toThrow('Invalid');
    await expect(getAuthorWorks(Array(12).fill('A1234'), {}, 1)).rejects.toThrow('Invalid');
    await expect(getWorksByIds(['W1|x'])).rejects.toThrow('Invalid');
    await expect(getWorksByIds(Array(51).fill('W12345'))).rejects.toThrow('Invalid');
    expect(await getWorksByIds([])).toEqual([]);
    expect(apis.calls).toHaveLength(0);
  });

  it('removes filter separators from free text', async () => {
    apis.on(when(OPENALEX, '/works', { body: oaList([]) }));
    await searchWorks({ author: 'Rahman,doi:10.1|x', onlyOurInstitution: false, page: 1, perPage: 5, sort: 'citations' });
    expect(apis.calls[0]?.searchParams.get('filter')).toBe('raw_author_name.search:Rahman doi 10.1 x');
    expect(apis.calls[0]?.searchParams.get('sort')).toBe('cited_by_count:desc');
  });

  it('caches the institution name and retries after a failure', async () => {
    apis.on(when(OPENALEX, '/institutions/', { status: 500 }));
    expect(await getInstitutionName()).toBeNull();
    apis.on(when(OPENALEX, '/institutions/', { body: { display_name: 'UPES' } }));
    expect(await getInstitutionName()).toBe('UPES');
    expect(await getInstitutionName()).toBe('UPES');
    expect(apis.calls.filter((u) => u.pathname.startsWith('/institutions'))).toHaveLength(2);
  });

  it('finds related profiles even when some look-ups fail', async () => {
    const me = mapAuthor(oaAuthor('A1111', 'Aisha Rahman'));
    apis.on(when(OPENALEX, '/authors', { body: oaList([oaAuthor('A2222', 'Aisha Rahman'), oaAuthor('A3333', 'Anil Rahman')]) }));
    apis.on(when(OPENALEX, '/works', { status: 500 }));
    const related = await findRelatedAuthors(me);
    expect(related.map((r) => [r.id, r.reason])).toEqual([['A2222', 'same-name']]);
  });
});

describe('ORCID client', () => {
  it.each([
    ['journal-article', 'JOURNAL_ARTICLE'],
    ['conference-paper', 'CONFERENCE_PAPER'],
    ['book', 'BOOK'],
    ['edited-book', 'BOOK'],
    ['book-chapter', 'BOOK_CHAPTER'],
    ['dissertation', 'THESIS'],
    ['dissertation-thesis', 'THESIS'],
    ['preprint', 'PREPRINT'],
    ['working-paper', 'PREPRINT'],
    ['patent', 'OTHER'],
    [undefined, 'OTHER'],
  ])('maps type %s -> %s', (type, expected) => {
    expect(mapOrcidType(type)).toBe(expected);
  });

  it('prefers the "self" DOI, ignores non-year dates and empty groups', () => {
    const works = mapWorksSummary({
      group: [
        {
          'work-summary': [
            {
              'put-code': '7',
              title: { title: { value: 'X' } },
              'publication-date': { year: { value: '20xx' } },
              'external-ids': {
                'external-id': [
                  { 'external-id-type': 'doi', 'external-id-value': '10.5555/part-of', 'external-id-relationship': 'part-of' },
                  { 'external-id-type': 'doi', 'external-id-value': '10.5555/SELF', 'external-id-relationship': 'self' },
                ],
              },
            },
          ],
        },
        { 'work-summary': [] },
      ],
    });
    expect(works).toEqual([{ putCode: '7', title: 'X', authors: [], venue: null, year: null, doi: '10.5555/self', type: 'OTHER' }]);
    expect(mapWorksSummary({})).toEqual([]);
  });

  it('skips error entries in bulk responses', () => {
    expect(mapBulkWorks({ bulk: [{ work: null }, { work: { 'put-code': 1, contributors: null } }] })).toHaveLength(1);
  });

  it('404s unknown records and validates put-codes before building the URL', async () => {
    apis.on(when(ORCID, '/', { status: 404 }));
    await expect(fetchWorkSummaries('0000-0002-1825-0097')).rejects.toMatchObject({ status: 404 });
    await expect(fetchWorkDetails('0000-0002-1825-0097', ['1'])).rejects.toMatchObject({ status: 404 });
    await expect(fetchWorkDetails('0000-0002-1825-0097', ['1/../x'])).rejects.toThrow('Invalid');
    expect(await fetchWorkDetails('0000-0002-1825-0097', [])).toEqual([]);
  });
});

describe('merging OpenAlex and Crossref results', () => {
  const work = (over: Partial<ScholarlyWork>): ScholarlyWork => ({
    openalexId: null, doi: null, title: 'Paper', authors: [], venue: null, year: 2020, type: 'OTHER', pdfUrl: null, citedByCount: 0, openAccess: false, sources: ['openalex'], ...over,
  });

  it('merges by DOI, or by title + year when one has no DOI, filling gaps', () => {
    const merged = mergeWorks(
      [work({ openalexId: 'W1', doi: '10.1/a', title: 'A', citedByCount: 3 }), work({ openalexId: 'W2', title: 'B: a study', year: 2021 })],
      [
        work({ doi: '10.1/a', title: 'A (Crossref)', pdfUrl: 'https://x/a.pdf', venue: 'J', citedByCount: 9, sources: ['crossref'] }),
        work({ doi: '10.1/b', title: 'b a study', year: 2021, sources: ['crossref'], matchNote: 'n' }),
        work({ doi: '10.1/c', title: 'C', sources: ['crossref'] }),
      ],
    );
    expect(merged).toHaveLength(3);
    expect(merged[0]).toMatchObject({ title: 'A', pdfUrl: 'https://x/a.pdf', venue: 'J', citedByCount: 9, sources: ['openalex', 'crossref'] });
    expect(merged[1]).toMatchObject({ openalexId: 'W2', doi: '10.1/b', matchNote: 'n', sources: ['openalex', 'crossref'] });
    expect(merged[2]).not.toHaveProperty('affiliations');
  });

  it('matches institutions on whole words only', () => {
    expect(affiliationMatches(['School of CS, UPES, Dehradun'], ['UPES'])).toBe(true);
    expect(affiliationMatches(['Groupes de recherche'], ['UPES'])).toBe(false);
    expect(affiliationMatches(['Anything'], ['AB'])).toBe(false); // too short to be meaningful
  });
});
