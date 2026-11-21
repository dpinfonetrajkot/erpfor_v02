import type { ApiError } from '@bht/shared';

/** Error thrown for any non-2xx API response. */
export class ApiRequestError extends Error {
  readonly status: number;
  readonly fieldErrors: Record<string, string>;

  constructor(body: ApiError) {
    super(body.message);
    this.status = body.statusCode;
    this.fieldErrors = body.errors ?? {};
  }
}

type Query = Record<string, string | number | boolean | null | undefined>;

interface RequestOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'DELETE';
  body?: unknown;
  query?: Query;
  /** Internal: set when retrying after a token refresh. */
  retried?: boolean;
}

let refreshing: Promise<boolean> | null = null;

/** Calls where a 401 must not trigger a token refresh (it would loop or make no sense). */
const NO_REFRESH = ['/auth/login', '/auth/refresh', '/auth/logout'];

/** One refresh at a time, even if many requests get 401 together. */
function refreshSession(): Promise<boolean> {
  refreshing ??= fetch('/api/auth/refresh', { method: 'POST', credentials: 'same-origin' })
    .then((r) => r.ok)
    .catch(() => false)
    .finally(() => setTimeout(() => (refreshing = null), 0));
  return refreshing;
}

function buildUrl(path: string, query?: Query): string {
  const params = new URLSearchParams();
  for (const [k, v] of Object.entries(query ?? {})) {
    if (v !== undefined && v !== null && v !== '') params.set(k, String(v));
  }
  const qs = params.toString();
  return `/api${path}${qs ? `?${qs}` : ''}`;
}

export async function api<T = unknown>(path: string, opts: RequestOptions = {}): Promise<T> {
  const isForm = opts.body instanceof FormData;
  const res = await fetch(buildUrl(path, opts.query), {
    method: opts.method ?? 'GET',
    credentials: 'same-origin',
    headers: opts.body && !isForm ? { 'Content-Type': 'application/json' } : undefined,
    body: opts.body === undefined ? undefined : isForm ? (opts.body as FormData) : JSON.stringify(opts.body),
  });

  // Includes /auth/me: after the 15-minute access token expires, reopening a page must renew it, not fail.
  if (res.status === 401 && !opts.retried && !NO_REFRESH.includes(path)) {
    if (await refreshSession()) return api<T>(path, { ...opts, retried: true });
    redirectToLogin();
  }

  if (!res.ok) {
    let body: ApiError;
    try {
      body = (await res.json()) as ApiError;
    } catch {
      body = { statusCode: res.status, message: res.statusText || 'Request failed' };
    }
    throw new ApiRequestError(body);
  }

  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

export function redirectToLogin() {
  if (typeof window === 'undefined' || window.location.pathname === '/login') return;
  const next = encodeURIComponent(window.location.pathname + window.location.search);
  window.location.href = `/login?next=${next}`;
}

export function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : 'Something went wrong';
}
