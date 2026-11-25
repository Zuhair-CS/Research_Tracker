import { CROSSREF, OPENALEX, crossrefItem, crossrefList, crossrefWork, oaAuthor, oaList, oaWork, type FakeApis, type Reply } from './fake-apis.js';

/**
 * A tiny fake scholarly world, answering the same query shapes our code
 * sends to OpenAlex and Crossref.
 *
 * Aisha Rahman (UPES) is split over several OpenAlex profiles, the way
 * OpenAlex really does it:
 *   A1000001  main profile, ORCID 0000-0002-1825-0097, works W1001 + W1002
 *   A1000002  "A. Rahman" at UPES (name variant), work W2001
 *   A1000004  same ORCID as the main profile, work W4001
 *   A1000003  another "Aisha Rahman" with a DIFFERENT ORCID -> never suggested
 * Papers outside the profiles:
 *   W3001  "Aisha Rahman", no affiliation recorded        -> possible match
 *   W3002  "Aisha Rahman" at another institution (I9999999)  -> dropped
 * Crossref:
 *   10.5555/w1  same paper as W1001                        -> merged / de-duplicated
 *   10.5555/c2  Aisha Rahman, UPES affiliation              -> confirmed extra
 *   10.5555/c3  Aisha Rahman, no affiliation                -> possible match
 *   10.5555/c4  "Anil Rahman"                               -> different person, dropped
 *   10.5555/c5  Aisha Rahman at MIT                         -> different institution, dropped
 */
export const UPES = 'I5847235';
export const MAIN = 'A1000001';
export const ORCID_MAIN = '0000-0002-1825-0097';

const inst = (id: string) => [{ id: `https://openalex.org/${id}` }];
const by = (authorId: string, raw: string, institutions = inst(UPES)) => ({
  author: { id: `https://openalex.org/${authorId}`, display_name: raw },
  raw_author_name: raw,
  institutions,
});

export const authors: Record<string, ReturnType<typeof oaAuthor>> = {
  A1000001: oaAuthor('A1000001', 'Aisha Rahman', { orcid: `https://orcid.org/${ORCID_MAIN}`, works_count: 2 }),
  A1000002: oaAuthor('A1000002', 'A. Rahman', { works_count: 1 }),
  A1000003: oaAuthor('A1000003', 'Aisha Rahman', { orcid: 'https://orcid.org/0000-0002-1694-233X', works_count: 40 }),
  A1000004: oaAuthor('A1000004', 'Aisha Rahman', { orcid: `https://orcid.org/${ORCID_MAIN}`, works_count: 1 }),
};

export const works = [
  oaWork('W1001', 'Deep learning for crop yield prediction', { doi: 'https://doi.org/10.5555/w1', cited_by_count: 50, authorships: [by('A1000001', 'Aisha Rahman')] }),
  oaWork('W1002', 'Soil moisture sensing at scale', { publication_year: 2021, cited_by_count: 5, open_access: { is_oa: false }, authorships: [by('A1000001', 'Aisha Rahman')] }),
  oaWork('W2001', 'Crop disease detection with drones', { doi: 'https://doi.org/10.5555/w2', authorships: [by('A1000002', 'A. Rahman')] }),
  oaWork('W4001', 'Irrigation scheduling with reinforcement learning', { doi: 'https://doi.org/10.5555/w4', authorships: [by('A1000004', 'Aisha Rahman')] }),
  oaWork('W3001', 'Crop yield datasets for South Asia', { doi: 'https://doi.org/10.5555/w3', authorships: [by('A9999999', 'Aisha Rahman', [])] }),
  oaWork('W3002', 'Marine biology of crop-eating fish', { authorships: [by('A1000003', 'Aisha Rahman', inst('I9999999'))] }),
];

const aff = (name: string) => [{ name }];
export const crossrefItems = [
  crossrefItem({ DOI: '10.5555/w1', title: ['Deep learning for crop yield prediction'] }),
  crossrefItem({ DOI: '10.5555/c2', title: ['Crop rotation planning'], 'is-referenced-by-count': 99 }),
  crossrefItem({ DOI: '10.5555/c3', title: ['A crop survey'], author: [{ given: 'Aisha', family: 'Rahman' }] }),
  crossrefItem({ DOI: '10.5555/c4', title: ['Crop pricing'], author: [{ given: 'Anil', family: 'Rahman', affiliation: aff('UPES') }] }),
  crossrefItem({ DOI: '10.5555/c5', title: ['Crop genetics'], author: [{ given: 'Aisha', family: 'Rahman', affiliation: aff('MIT') }] }),
];

const short = (url: string) => url.replace('https://openalex.org/', '');
const family = (text: string) => text.trim().split(/\s+/).pop()?.toLowerCase() ?? '';

/** Answers OpenAlex requests from the catalogue above. */
export function openalexReply(url: URL): Reply | undefined {
  if (url.host !== OPENALEX) return undefined;
  const path = decodeURIComponent(url.pathname);
  const filter = url.searchParams.get('filter') ?? '';
  if (path.startsWith('/institutions/')) return { body: { display_name: 'University of Petroleum and Energy Studies' } };
  if (path.startsWith('/authors/orcid:')) {
    const a = Object.values(authors).find((x) => x.orcid?.endsWith(path.split('orcid:')[1] ?? '-'));
    return a ? { body: a } : { status: 404 };
  }
  if (path.startsWith('/authors/')) {
    const a = authors[path.split('/')[2] ?? ''];
    return a ? { body: a } : { status: 404 };
  }
  if (path === '/authors') {
    let list = Object.values(authors);
    for (const clause of filter.split(',').filter(Boolean)) {
      const [key, value = ''] = [clause.slice(0, clause.indexOf(':')), clause.slice(clause.indexOf(':') + 1)];
      if (key === 'orcid') list = list.filter((a) => a.orcid?.endsWith(value));
      if (key === 'ids.openalex') list = list.filter((a) => value.split('|').includes(short(a.id)));
    }
    const q = url.searchParams.get('search');
    if (q) list = list.filter((a) => a.display_name.toLowerCase().includes(family(q)));
    return { body: oaList(list) };
  }
  if (path === '/works') {
    let list = works;
    for (const clause of filter.split(',').filter(Boolean)) {
      const key = clause.slice(0, clause.indexOf(':'));
      const value = clause.slice(clause.indexOf(':') + 1);
      const values = value.split('|');
      if (key === 'author.id') list = list.filter((w) => w.authorships.some((a) => values.includes(short(a.author.id))));
      if (key === 'ids.openalex') list = list.filter((w) => values.includes(short(w.id)));
      if (key === 'doi') list = list.filter((w) => w.doi && values.includes(w.doi.replace('https://doi.org/', '')));
      if (key === 'raw_author_name.search') list = list.filter((w) => w.authorships.some((a) => a.raw_author_name.toLowerCase().includes(family(value))));
      if (key === 'authorships.institutions.id') list = list.filter((w) => w.authorships.some((a) => a.institutions.some((i) => values.includes(short(i.id)))));
      if (key === 'open_access.is_oa') list = list.filter((w) => w.open_access.is_oa);
    }
    const q = url.searchParams.get('search');
    if (q) list = list.filter((w) => w.title.toLowerCase().includes(q.toLowerCase()));
    return { body: oaList(list) };
  }
  return undefined;
}

/** Answers Crossref search (/works?query...) and DOI look-ups (/works/{doi}). */
export function crossrefReply(url: URL): Reply | undefined {
  if (url.host !== CROSSREF) return undefined;
  if (url.pathname === '/works') {
    const q = url.searchParams.get('query.bibliographic');
    const list = q ? crossrefItems.filter((i) => (i.title as string[])[0]?.toLowerCase().includes(q.toLowerCase())) : crossrefItems;
    return { body: crossrefList(list, 1234) };
  }
  if (url.pathname.startsWith('/works/')) {
    const doi = decodeURIComponent(url.pathname.slice('/works/'.length));
    const item = crossrefItems.find((i) => i.DOI === doi);
    return item ? { body: crossrefWork(item) } : { status: 404 };
  }
  return undefined;
}

export function installCatalog(apis: FakeApis): void {
  apis.on(openalexReply);
  apis.on(crossrefReply);
}
