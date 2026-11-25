import { describe, expect, it, vi } from 'vitest';

// The response cache is switched off under NODE_ENV=test; this file runs with
// development settings (read when the module loads) to test the cache itself.
vi.hoisted(() => {
  process.env.NODE_ENV = 'development';
  process.env.OPENALEX_API_KEY = 'fake-test-key-123';
  process.env.API_CONTACT_EMAIL = 'tester@example.org';
});

const { installFakeApis, when, OPENALEX, oaList } = await import('../helpers/fake-apis.js');
const { fetchJson } = await import('../../src/services/http-client.js');
const { searchAuthors } = await import('../../src/services/openalex.js');

const apis = installFakeApis();

describe('external API cache (development / production)', () => {
  it('answers a repeated request from memory and evicts the oldest entry past 500', async () => {
    apis.on(when('cache.test', '/', { body: { n: 1 } }));
    const url = new URL('https://cache.test/a');
    await fetchJson(url, {});
    await fetchJson(url, {});
    expect(apis.calls).toHaveLength(1);

    for (let i = 0; i < 501; i++) await fetchJson(new URL(`https://cache.test/fill/${i}`), {});
    await fetchJson(url, {}); // evicted, fetched again
    expect(apis.calls).toHaveLength(503);
  });

  it('expires entries after 10 minutes', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    apis.on(when('cache.test', '/', { body: { n: 2 } }));
    const url = new URL('https://cache.test/expiring');
    const before = apis.calls.length;
    await fetchJson(url, {});
    vi.setSystemTime(Date.now() + 11 * 60 * 1000);
    await fetchJson(url, {});
    expect(apis.calls.length - before).toBe(2);
    vi.useRealTimers();
  });

  it('adds the API key and contact e-mail to OpenAlex requests (server side only)', async () => {
    apis.on(when(OPENALEX, '/authors', { body: oaList([], 0) }));
    await searchAuthors({ onlyOurInstitution: true, hasOrcid: false, sort: 'relevance', page: 1, perPage: 5 });
    const sent = apis.calls.at(-1);
    expect(sent?.searchParams.get('api_key')).toBe('fake-test-key-123');
    expect(sent?.searchParams.get('mailto')).toBe('tester@example.org');
  });
});
