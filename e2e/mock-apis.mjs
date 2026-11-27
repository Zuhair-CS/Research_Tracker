// A stand-in for Crossref (and ORCID / OpenAlex) during end-to-end tests, so
// the browser tests never depend on the internet or on real data changing.
import { createServer } from 'node:http';

const PORT = Number(process.env.MOCK_PORT ?? 4010);

/**
 * The fake Crossref knows every DOI of the form 10.5555/e2e.<run-id>, so each
 * test run can use its own DOI (runs stay independent, retries do not clash).
 * The run id is put in the title so the test can find its own record.
 * Any other DOI is "not found".
 */
function crossrefItem(doi) {
  const m = /^10\.5555\/e2e\.([a-z0-9-]{1,40})$/.exec(doi);
  if (!m) return null;
  return {
    DOI: doi.toUpperCase(),
    title: [`Automated pipelines for <i>secure</i> research software ${m[1]}`],
    author: [
      { given: 'Aisha', family: 'Rahman' },
      { given: 'Sara', family: 'Khan' },
    ],
    'container-title': ['Journal of Secure Software'],
    type: 'proceedings-article',
    issued: { 'date-parts': [[2025, 3, 14]] },
    link: [{ URL: 'https://example.org/e2e-demo.pdf', 'content-type': 'application/pdf' }],
  };
}

const send = (res, status, body) => {
  res.writeHead(status, { 'content-type': 'application/json' });
  res.end(JSON.stringify(body));
};

createServer((req, res) => {
  const url = new URL(req.url ?? '/', `http://127.0.0.1:${PORT}`);
  if (url.pathname === '/health') return send(res, 200, { status: 'ok' });

  if (url.pathname.startsWith('/crossref/works/')) {
    const item = crossrefItem(decodeURIComponent(url.pathname.slice('/crossref/works/'.length)).toLowerCase());
    return item ? send(res, 200, { status: 'ok', message: item }) : send(res, 404, { status: 'not found' });
  }
  if (url.pathname === '/crossref/works') return send(res, 200, { message: { 'total-results': 0, items: [] } });
  if (url.pathname.startsWith('/openalex/institutions/')) return send(res, 200, { display_name: 'University of Petroleum and Energy Studies' });
  if (url.pathname.startsWith('/openalex/')) return send(res, 200, { meta: { count: 0 }, results: [] });
  return send(res, 404, { error: 'not mocked' });
}).listen(PORT, '127.0.0.1', () => console.log(`mock APIs on ${PORT}`));
