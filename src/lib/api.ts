import type { Role } from "./types";

// Same-origin by default: next.config.ts proxies /api/* to the backend (BACKEND_URL), so an
// HTTPS deployment never calls the plain-HTTP API directly (browsers block that).
export const API_URL = process.env.NEXT_PUBLIC_API_URL || "/api";

const ACCESS_KEY = "mc_access";
const REFRESH_KEY = "mc_refresh";

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
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
// Requests. Access tokens last 30 minutes; on a 401 the refresh token is exchanged
// once (shared across concurrent requests) and the request retried.
// ---------------------------------------------------------------------------

let refreshInFlight: Promise<boolean> | null = null;

function refreshAccessToken(): Promise<boolean> {
  const refreshToken = tokenStore.getRefresh();
  if (!refreshToken) return Promise.resolve(false);
  refreshInFlight ??= (async () => {
    try {
      const res = await fetch(`${API_URL}/auth/refresh`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ refresh_token: refreshToken }),
      });
      if (!res.ok) return false;
      const data = (await res.json()) as { access_token: string };
      tokenStore.set(data.access_token);
      return true;
    } catch {
      return false;
    } finally {
      refreshInFlight = null;
    }
  })();
  return refreshInFlight;
}

interface RequestOptions {
  method?: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  body?: unknown;
  /** Send the access token (default true). Public endpoints and login pass false. */
  auth?: boolean;
}

export async function api<T>(path: string, { method = "GET", body, auth = true }: RequestOptions = {}): Promise<T> {
  const send = async () => {
    const headers: Record<string, string> = {};
    if (body !== undefined) headers["Content-Type"] = "application/json";
    const access = auth ? tokenStore.getAccess() : null;
    if (access) headers.Authorization = `Bearer ${access}`;
    try {
      return await fetch(`${API_URL}${path}`, {
        method,
        headers,
        body: body !== undefined ? JSON.stringify(body) : undefined,
      });
    } catch {
      throw new ApiError(0, "Can't reach the MedConnect server. Make sure the backend is running.");
    }
  };

  let res = await send();
  if (res.status === 401 && auth && tokenStore.getRefresh()) {
    if (await refreshAccessToken()) {
      res = await send();
    }
    if (res.status === 401) tokenStore.clear(); // session is over; the UI sends the user to login
  }

  const data: unknown = res.status === 204 ? null : await res.json().catch(() => null);
  if (!res.ok) throw new ApiError(res.status, errorMessage(data, res.status));
  return data as T;
}

export function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : "Something went wrong.";
}
