/**
 * Tiny fetch wrapper for our own API.
 *
 * SECURITY:
 *  - The session lives in an httpOnly cookie; this code never sees or stores
 *    it (nothing sensitive in localStorage, where an XSS bug could read it).
 *  - Every state-changing request carries the CSRF token in a header.
 *  - Requests go to the same origin only (relative "/api" URLs).
 */

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
    public readonly details: { path: string; message: string }[] = [],
  ) {
    super(message);
  }
}

let csrfToken: string | null = null;

export function setCsrfToken(token: string | null): void {
  csrfToken = token;
}

async function ensureCsrfToken(): Promise<string> {
  if (!csrfToken) {
    const res = await fetch('/api/auth/csrf', { credentials: 'same-origin' });
    csrfToken = ((await res.json()) as { csrfToken: string }).csrfToken;
  }
  return csrfToken;
}

type Query = Record<string, string | number | boolean | undefined | null>;

export function toQueryString(query: Query = {}): string {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value !== undefined && value !== null && value !== '' && value !== false) params.set(key, String(value));
  }
  const s = params.toString();
  return s ? `?${s}` : '';
}

interface Options {
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  body?: unknown;
  /** Send plain text instead of JSON (used for file uploads such as BibTeX). */
  text?: string;
  query?: Query;
}

export async function api<T>(path: string, { method = 'GET', body, text, query }: Options = {}, retried = false): Promise<T> {
  const headers: Record<string, string> = {};
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (text !== undefined) headers['Content-Type'] = 'text/plain; charset=utf-8';
  if (method !== 'GET') headers['X-CSRF-Token'] = await ensureCsrfToken();

  const res = await fetch(`/api${path}${toQueryString(query)}`, {
    method,
    headers,
    credentials: 'same-origin',
    body: text ?? (body === undefined ? undefined : JSON.stringify(body)),
  });

  if (res.status === 204) return undefined as T;
  const data = (await res.json().catch(() => ({}))) as {
    error?: { code: string; message: string; details?: { path: string; message: string }[] };
  };

  if (!res.ok) {
    const err = data.error ?? { code: 'HTTP_ERROR', message: `Request failed (${res.status})` };
    // The session may have expired and taken its CSRF token with it: fetch a new one and retry once.
    if (err.code === 'CSRF_INVALID' && !retried) {
      csrfToken = null;
      return api<T>(path, { method, body, text, query }, true);
    }
    throw new ApiError(res.status, err.code, err.message, err.details);
  }
  return data as T;
}

/** Human-readable message for an error, including field-level validation problems. */
export function errorMessage(err: unknown): string {
  if (err instanceof ApiError) {
    if (err.details.length) return `${err.message}: ${err.details.map((d) => `${d.path || 'value'} - ${d.message}`).join('; ')}`;
    return err.message;
  }
  return 'Something went wrong. Please try again.';
}
