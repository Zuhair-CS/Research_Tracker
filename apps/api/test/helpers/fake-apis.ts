import { vi } from 'vitest';

/**
 * Fake Crossref / ORCID / OpenAlex.
 *
 * The real APIs are never called in tests: global fetch is replaced by a
 * router that answers from fixtures. Any request no route handles fails the
 * call loudly, so a test can never silently depend on the internet.
 */
export type Reply = { status?: number; body?: unknown; text?: string; throws?: Error };
export type Route = (url: URL, init?: RequestInit) => Reply | undefined;

export interface FakeApis {
  /** Every URL fetched, in order (to assert what was sent upstream). */
  calls: URL[];
  /** Add a route; later routes win over earlier ones. */
  on: (route: Route) => void;
  reset: () => void;
}

export function installFakeApis(): FakeApis {
  let routes: Route[] = [];
  const calls: URL[] = [];
  const fake = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url);
    calls.push(url);
    for (const route of [...routes].reverse()) {
      const reply = route(url, init);
      if (!reply) continue;
      if (reply.throws) throw reply.throws;
      const text = reply.text ?? JSON.stringify(reply.body ?? {});
      return new Response(text, { status: reply.status ?? 200, headers: { 'content-type': 'application/json' } });
    }
    throw new Error(`Unmocked external request: ${url.host}${url.pathname}`);
  });
  vi.stubGlobal('fetch', fake);
  return {
    calls,
    on: (route) => void routes.push(route),
    reset: () => {
      routes = [];
      calls.length = 0;
    },
  };
}

/** Route helper: match host + path prefix, optionally a predicate on the URL. */
export const when =
  (host: string, pathPrefix: string, reply: Reply | ((url: URL) => Reply), match: (url: URL) => boolean = () => true): Route =>
  (url) =>
    url.host === host && url.pathname.startsWith(pathPrefix) && match(url) ? (typeof reply === 'function' ? reply(url) : reply) : undefined;

export const CROSSREF = 'api.crossref.org';
export const ORCID = 'pub.orcid.org';
export const OPENALEX = 'api.openalex.org';

// ------------------------------------------------------------------ fixtures

export function crossrefItem(over: Partial<Record<string, unknown>> & { DOI: string }) {
  return {
    title: ['Deep learning for crop yield prediction'],
    author: [{ given: 'Aisha', family: 'Rahman', affiliation: [{ name: 'University of Petroleum and Energy Studies' }] }],
    'container-title': ['Journal of Testing'],
    type: 'journal-article',
    issued: { 'date-parts': [[2023, 5, 1]] },
    link: [{ URL: 'https://example.org/paper.pdf', 'content-type': 'application/pdf' }],
    'is-referenced-by-count': 7,
    ...over,
  };
}

export const crossrefWork = (item: object) => ({ status: 'ok', message: item });
export const crossrefList = (items: object[], total = items.length) => ({ message: { 'total-results': total, items } });

export function oaAuthor(id: string, name: string, over: Record<string, unknown> = {}) {
  return {
    id: `https://openalex.org/${id}`,
    display_name: name,
    orcid: null as string | null,
    works_count: 10,
    cited_by_count: 100,
    last_known_institutions: [{ id: 'https://openalex.org/I5847235', display_name: 'University of Petroleum and Energy Studies' }],
    ...over,
  };
}

export function oaWork(id: string, title: string, over: Record<string, unknown> = {}) {
  return {
    id: `https://openalex.org/${id}`,
    doi: null as string | null,
    title,
    display_name: title,
    publication_year: 2022,
    type: 'article',
    cited_by_count: 3,
    open_access: { is_oa: true },
    primary_location: { source: { display_name: 'Testing Letters', type: 'journal' } },
    best_oa_location: { pdf_url: 'https://example.org/oa.pdf' },
    authorships: [
      {
        author: { id: 'https://openalex.org/A1000001', display_name: 'Aisha Rahman' },
        raw_author_name: 'Aisha Rahman',
        institutions: [{ id: 'https://openalex.org/I5847235' }],
      },
    ],
    ...over,
  };
}

export const oaList = (results: object[], count = results.length) => ({ meta: { count }, results });
