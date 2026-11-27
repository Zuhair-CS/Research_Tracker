import { config } from '../config/env.js';
import { HttpError, badGateway } from '../lib/errors.js';
import { logger } from '../lib/logger.js';

const MAX_RESPONSE_BYTES = 5 * 1024 * 1024;

/** Identifies our app to Crossref/OpenAlex, with a contact e-mail as their usage policies request. */
export const USER_AGENT = `PB1-PubTrack/0.1${config.API_CONTACT_EMAIL ? ` (mailto:${config.API_CONTACT_EMAIL})` : ''}`;

/**
 * Small wrapper around fetch() for calling the public Crossref / ORCID APIs.
 *
 * SECURITY:
 *  - Only fixed base URLs from configuration are ever called (callers build
 *    the path from values that were already strictly validated).
 *  - redirect: 'error' -> a redirect to some other (possibly internal) host
 *    is refused, another SSRF defence.
 *  - A timeout and a response-size cap stop a slow or huge response from
 *    tying up our server (denial of service).
 *  - The JSON is treated as untrusted input and validated with zod by the caller.
 */
export async function fetchJson(url: URL, headers: Record<string, string>): Promise<{ status: number; body: unknown }> {
  const cached = cache.get(url.href);
  if (cached && cached.expires > Date.now()) return cached.value;
  const value = await fetchJsonUncached(url, headers);
  remember(url.href, value);
  return value;
}

/**
 * Small in-memory cache of external API answers (10 minutes, 500 entries).
 * Scholarly records rarely change, and the free API tiers are rate-limited,
 * so flipping back a page or re-opening a profile should not cost a new call.
 */
const CACHE_TTL_MS = 10 * 60 * 1000;
const CACHE_MAX = 500;
const cache = new Map<string, { expires: number; value: { status: number; body: unknown } }>();

function remember(key: string, value: { status: number; body: unknown }): void {
  if (config.NODE_ENV === 'test') return;
  cache.delete(key);
  cache.set(key, { expires: Date.now() + CACHE_TTL_MS, value });
  if (cache.size > CACHE_MAX) cache.delete(cache.keys().next().value as string); // drop the oldest entry
}

async function fetchJsonUncached(url: URL, headers: Record<string, string>): Promise<{ status: number; body: unknown }> {
  let response: Response;
  try {
    response = await fetch(url, {
      headers: { Accept: 'application/json', ...headers },
      redirect: 'error',
      signal: AbortSignal.timeout(config.EXTERNAL_API_TIMEOUT_MS),
    });
  } catch (err) {
    // Only the host name is logged: the full URL may carry an API key in its query string.
    logger.warn({ error: (err as Error).message, host: url.host }, 'External API request failed');
    throw badGateway(`Could not reach ${url.host}`);
  }

  if (response.status === 404) return { status: 404, body: null };
  if (response.status === 429) {
    logger.warn({ host: url.host }, 'External API rate limit reached');
    throw new HttpError(
      503,
      'UPSTREAM_RATE_LIMITED',
      url.host.includes('openalex')
        ? 'OpenAlex is limiting requests right now. Try again in a minute, or add a free OPENALEX_API_KEY to the server settings.'
        : `${url.host} is limiting requests right now. Please try again in a minute.`,
    );
  }
  if (!response.ok) {
    logger.warn({ status: response.status, host: url.host }, 'External API returned an error');
    throw badGateway(`${url.host} returned an error (${response.status})`);
  }

  const text = await response.text();
  if (text.length > MAX_RESPONSE_BYTES) throw badGateway(`${url.host} response was too large`);
  try {
    return { status: response.status, body: JSON.parse(text) as unknown };
  } catch {
    throw new HttpError(502, 'UPSTREAM_ERROR', `${url.host} returned invalid JSON`);
  }
}

/**
 * Build `${base}/${segment1}/${segment2}` with every segment URL-encoded, so a
 * value can never break out of its path segment (no "/", "?", "#" or "..").
 */
export function apiUrl(base: string, ...segments: string[]): URL {
  return new URL(`${base.replace(/\/+$/, '')}/${segments.map(encodeURIComponent).join('/')}`);
}

/** Strip any HTML/JATS markup (e.g. <i>, <sub>) from titles so we only store plain text. */
export function plainText(value: string): string {
  return value
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, '&')
    .replace(/<[^>]*>/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}
