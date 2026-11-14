import type { Role, TokenPair } from "./types";

// Same-origin by default: next.config.ts proxies /api/* to the backend (BACKEND_URL), so an
// HTTPS deployment never calls the plain-HTTP API directly (browsers block that).
export const API_URL = process.env.NEXT_PUBLIC_API_URL || "/api";

const ACCESS_KEY = "mc_access";
const REFRESH_KEY = "mc_refresh";

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
    /** Seconds to wait before trying again (429 "too many attempts" responses). */
    public retryAfter?: number,
  ) {
    super(message);
  }
}

function retryAfterOf(res: Response): number | undefined {
  const seconds = Number(res.headers.get("Retry-After"));
  return Number.isFinite(seconds) && seconds > 0 ? Math.ceil(seconds) : undefined;
}

// ---------------------------------------------------------------------------
// Token storage. Tokens live in localStorage so a session survives reloads; the
// backend is the real gatekeeper (every request is checked server-side). The store is
// observable so the UI reacts to login/logout — including from other tabs.
// ---------------------------------------------------------------------------

const listeners = new Set<() => void>();

function read(key: string): string | null {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

function write(key: string, value: string | null) {
  try {
    if (value === null) window.localStorage.removeItem(key);
    else window.localStorage.setItem(key, value);
  } catch {
    // Storage unavailable (private mode, blocked): the session just won't persist.
  }
}

function emit() {
  listeners.forEach((listener) => listener());
}

export const tokenStore = {
  getAccess: () => read(ACCESS_KEY),
  getRefresh: () => read(REFRESH_KEY),
  set(access: string, refresh?: string) {
    write(ACCESS_KEY, access);
    if (refresh !== undefined) write(REFRESH_KEY, refresh);
    emit();
  },
  clear() {
    write(ACCESS_KEY, null);
    write(REFRESH_KEY, null);
    emit();
  },
  subscribe(listener: () => void) {
    listeners.add(listener);
    window.addEventListener("storage", listener);
    return () => {
      listeners.delete(listener);
      window.removeEventListener("storage", listener);
    };
  },
};

export interface JwtClaims {
  sub: string;
  role?: Role;
  exp: number;
}

// Reads (does not verify) the claims — only to route the UI; the API verifies the token.
export function decodeJwt(token: string): JwtClaims | null {
  try {
    const payload = token.split(".")[1].replace(/-/g, "+").replace(/_/g, "/");
    return JSON.parse(atob(payload)) as JwtClaims;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Errors: FastAPI returns {"detail": "..."} for business errors and
// {"detail": [{loc, msg}, ...]} for validation errors.
// ---------------------------------------------------------------------------

function humanizeField(field: string) {
  const text = field.replace(/_/g, " ");
  return text.charAt(0).toUpperCase() + text.slice(1);
}

function errorMessage(body: unknown, status: number): string {
  const detail = (body as { detail?: unknown } | null)?.detail;
  if (typeof detail === "string") return detail;
  if (Array.isArray(detail)) {
    return detail
      .map((item: { loc?: (string | number)[]; msg?: string }) => {
        const field = item.loc?.filter((part) => part !== "body").at(-1);
        const message = String(item.msg ?? "Invalid value").replace(/^Value error, /, "");
        return typeof field === "string" ? `${humanizeField(field)}: ${message}` : message;
      })
      .join(". ");
  }
  if (status >= 500) return "Something went wrong on the server. Please try again.";
  return `Request failed (${status}).`;
}

// ---------------------------------------------------------------------------
// Requests. Access tokens last 30 minutes; on a 401 the refresh token is exchanged for a new
// pair and the request retried. Refresh tokens are single-use: the server retires the old one
// and answers with a new one, which must replace it (another use of the old one, later, would
// count as a stolen token and log the user out everywhere).
// - One refresh at a time per tab: concurrent requests share it.
// - Across tabs (they share localStorage): a Web Lock, where the browser has them, lets one tab
//   refresh while the others wait, and a tab that waited uses the pair just stored instead of
//   spending the same token again. Without Web Locks, the server accepts the just-retired token
//   for a few seconds and hands back the same new pair.
// ---------------------------------------------------------------------------

let refreshInFlight: Promise<boolean> | null = null;

/** Get a fresh access token; true if there is one to retry with. `failedAccess` is the access
 * token the server just refused (null if none was sent). */
function refreshTokens(failedAccess: string | null): Promise<boolean> {
  refreshInFlight ??= (async () => {
    try {
      // (navigator.locks is missing outside secure contexts, e.g. plain-HTTP testing on a LAN.)
      const locks = typeof navigator !== "undefined" ? navigator.locks : undefined;
      const exchange = () => exchangeRefreshToken(failedAccess);
      return locks ? await locks.request("mc-refresh", exchange) : await exchange();
    } finally {
      refreshInFlight = null;
    }
  })();
  return refreshInFlight;
}

async function exchangeRefreshToken(failedAccess: string | null): Promise<boolean> {
  const access = tokenStore.getAccess();
  if (access && access !== failedAccess) return true; // another tab refreshed meanwhile
  const refreshToken = tokenStore.getRefresh();
  if (!refreshToken) return false;
  let res: Response;
  try {
    res = await fetch(`${API_URL}/auth/refresh`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ refresh_token: refreshToken }),
    });
  } catch {
    return false; // offline or server down: keep the session, the request just fails
  }
  if (res.status === 401) {
    // The session is over (logged out, ended everywhere, expired), unless another tab stored a
    // new pair meanwhile. Clearing sends the user to log in (in every tab).
    if (tokenStore.getRefresh() === refreshToken) tokenStore.clear();
    return tokenStore.getAccess() !== null && tokenStore.getAccess() !== failedAccess;
  }
  if (!res.ok) return false;
  try {
    const pair = (await res.json()) as TokenPair;
    tokenStore.set(pair.access_token, pair.refresh_token);
    return true;
  } catch {
    return false;
  }
}

/** Sends a request with the access token, refreshing it once on a 401 and retrying. */
async function withSession(send: (access: string | null) => Promise<Response>, auth: boolean): Promise<Response> {
  const access = auth ? tokenStore.getAccess() : null;
  const res = await send(access);
  if (res.status !== 401 || !auth || !tokenStore.getRefresh()) return res;
  if (!(await refreshTokens(access))) return res;
  const retryAccess = tokenStore.getAccess();
  const retried = await send(retryAccess);
  // Refused even with a fresh token: the session is over (unless it changed meanwhile).
  if (retried.status === 401 && tokenStore.getAccess() === retryAccess) tokenStore.clear();
  return retried;
}

interface RequestOptions {
  method?: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  /** JSON-encoded, except FormData (a file upload), which is sent as multipart. */
  body?: unknown;
  /** "blob" for file downloads (medical files need the access token, so no plain links). */
  responseType?: "json" | "blob";
  /** Send the access token (default true). Public endpoints and login pass false. */
  auth?: boolean;
  /** Aborts the request (e.g. a long poll when the page goes away). */
  signal?: AbortSignal;
}

export async function api<T>(
  path: string,
  { method = "GET", body, auth = true, signal, responseType = "json" }: RequestOptions = {},
): Promise<T> {
  const isForm = typeof FormData !== "undefined" && body instanceof FormData;
  const send = async (access: string | null) => {
    const headers: Record<string, string> = {};
    if (body !== undefined && !isForm) headers["Content-Type"] = "application/json";
    if (access) headers.Authorization = `Bearer ${access}`;
    try {
      return await fetch(`${API_URL}${path}`, {
        method,
        headers,
        body: isForm ? (body as FormData) : body !== undefined ? JSON.stringify(body) : undefined,
        signal,
      });
    } catch (e) {
      if (signal?.aborted) throw e;
      throw new ApiError(0, "Can't reach the MedConnect server. Make sure the backend is running.");
    }
  };

  const res = await withSession(send, auth);

  if (responseType === "blob" && res.ok) return (await res.blob()) as T;
  const data: unknown = res.status === 204 ? null : await res.json().catch(() => null);
  if (!res.ok) throw new ApiError(res.status, errorMessage(data, res.status), retryAfterOf(res));
  return data as T;
}

export function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : "Something went wrong.";
}

/**
 * A POST whose response is read as a stream (the assistant's reply, as server-sent events),
 * with the same one-time token refresh as `api`. Resolves to the open response; a refused
 * request (not 2xx) throws an ApiError with the server's message.
 */
export async function apiStream(path: string, body: unknown, signal?: AbortSignal): Promise<Response> {
  const send = async (access: string | null) => {
    const headers: Record<string, string> = { "Content-Type": "application/json", Accept: "text/event-stream" };
    if (access) headers.Authorization = `Bearer ${access}`;
    try {
      return await fetch(`${API_URL}${path}`, { method: "POST", headers, body: JSON.stringify(body), signal });
    } catch (e) {
      if (signal?.aborted) throw e;
      throw new ApiError(0, "Can't reach the MedConnect server. Make sure the backend is running.");
    }
  };
  const res = await withSession(send, true);
  if (!res.ok) {
    const data: unknown = await res.json().catch(() => null);
    throw new ApiError(res.status, errorMessage(data, res.status), retryAfterOf(res));
  }
  return res;
}

/** Server-sent events from a streamed response, one {event, data} at a time. */
export async function* readEvents(res: Response): AsyncGenerator<{ event: string; data: unknown }> {
  if (!res.body) return;
  const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
  let buffer = "";
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += value;
    let end;
    while ((end = buffer.indexOf("\n\n")) !== -1) {
      const block = buffer.slice(0, end);
      buffer = buffer.slice(end + 2);
      let event = "message";
      const data: string[] = [];
      for (const line of block.split("\n")) {
        if (line.startsWith("event:")) event = line.slice(6).trim();
        else if (line.startsWith("data:")) data.push(line.slice(5).trimStart());
      }
      if (data.length) yield { event, data: JSON.parse(data.join("\n")) };
    }
  }
}
