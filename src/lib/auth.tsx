"use client";

import { createContext, startTransition, useCallback, useContext, useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";

import { api, decodeJwt, tokenStore } from "./api";
import type { DoctorProfile, PatientProfile, Role, TokenPair } from "./types";

export interface Session {
  userId: number;
  role: Role;
}

interface AuthContextValue {
  /** "loading" until the browser has read the stored session (always so during prerender). */
  status: "loading" | "anonymous" | "authenticated";
  session: Session | null;
  /** The profile's full_name; null until loaded or if not filled in yet. */
  displayName: string | null;
  profileLoaded: boolean;
  login(email: string, password: string): Promise<Session>;
  register(email: string, password: string, role: Role): Promise<Session>;
  logout(): Promise<void>;
  /** Re-read the profile after it was edited (keeps the navbar name current). */
  reloadProfile(): void;
}

const AuthContext = createContext<AuthContextValue | null>(null);

function sessionFromToken(token: string | null): Session | null {
  const claims = token ? decodeJwt(token) : null;
  if (!claims?.role) return null;
  return { userId: Number(claims.sub), role: claims.role };
}

export function AuthProvider({ children }: { children: ReactNode }) {
  // undefined = not read yet (server prerender and hydration).
  const [access, setAccess] = useState<string | null | undefined>(undefined);

  useEffect(() => {
    // The stored session is adopted in a transition, not via useSyncExternalStore: that hook
    // applies the post-hydration change as an urgent update, which reaches the navbar's
    // Suspense boundary before it has hydrated and makes React discard its server HTML
    // (React error #418). A transition lets React finish hydrating the boundary first.
    // Login/logout below still update immediately — they set state from the event itself.
    const adopt = () => startTransition(() => setAccess(tokenStore.getAccess()));
    adopt();
    return tokenStore.subscribe(adopt); // token refresh, expiry, other tabs
  }, []);

  const session = useMemo(() => (access === undefined ? null : sessionFromToken(access)), [access]);
  const status = access === undefined ? "loading" : session ? "authenticated" : "anonymous";

  const [profile, setProfile] = useState<{ key: string; name: string | null } | null>(null);
  const [profileVersion, setProfileVersion] = useState(0);
  const profileKey = session ? `${session.role}-${session.userId}-${profileVersion}` : null;

  useEffect(() => {
    if (!session || !profileKey) return;
    let cancelled = false;
    const path = session.role === "doctor" ? "/doctors/me" : "/patients/me";
    api<DoctorProfile | PatientProfile>(path)
      .then((p) => !cancelled && setProfile({ key: profileKey, name: p.full_name }))
      .catch(() => !cancelled && setProfile({ key: profileKey, name: null }));
    return () => {
      cancelled = true;
    };
  }, [session, profileKey]);

  const current = profile && profile.key === profileKey ? profile : null;

  const login = useCallback(async (email: string, password: string) => {
    const pair = await api<TokenPair>("/auth/login", { method: "POST", body: { email, password }, auth: false });
    tokenStore.set(pair.access_token, pair.refresh_token);
    setAccess(pair.access_token);
    const s = sessionFromToken(pair.access_token);
    if (!s) throw new Error("Unexpected login response.");
    return s;
  }, []);

  const register = useCallback(
    async (email: string, password: string, role: Role) => {
      await api("/auth/register", { method: "POST", body: { email, password, role }, auth: false });
      return login(email, password);
    },
    [login],
  );

  const logout = useCallback(async () => {
    const refreshToken = tokenStore.getRefresh();
    tokenStore.clear();
    setAccess(null);
    if (refreshToken) {
      // Revoke server-side too; the local session is already gone either way.
      await api("/auth/logout", { method: "POST", body: { refresh_token: refreshToken }, auth: false }).catch(() => {});
    }
  }, []);

  const reloadProfile = useCallback(() => setProfileVersion((v) => v + 1), []);

  const value = useMemo<AuthContextValue>(
    () => ({
      status,
      session,
      displayName: current?.name ?? null,
      profileLoaded: current !== null,
      login,
      register,
      logout,
      reloadProfile,
    }),
    [status, session, current, login, register, logout, reloadProfile],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const value = useContext(AuthContext);
  if (!value) throw new Error("useAuth must be used inside <AuthProvider>");
  return value;
}

export function dashboardPath(role: Role): string {
  return role === "doctor" ? "/doctor" : "/patient";
}
