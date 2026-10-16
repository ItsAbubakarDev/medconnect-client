"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";
import type { ReactNode } from "react";

import { dashboardPath, useAuth } from "@/lib/auth";
import type { Role } from "@/lib/types";

import { ButtonLink, Container, PageLoading } from "./ui";

/** Client-side gate for signed-in pages. The API enforces the same rules server-side. */
export function RequireRole({ role, children }: { role?: Role; children: ReactNode }) {
  const { status, session } = useAuth();
  const router = useRouter();

  useEffect(() => {
    // Read the URL here (browser-only) rather than via usePathname(): reading URL data
    // during render would force a Suspense boundary on every dynamic route (Cache Components).
    if (status === "anonymous") {
      const here = window.location.pathname + window.location.search;
      router.replace(`/login?next=${encodeURIComponent(here)}`);
    }
  }, [status, router]);

  if (status !== "authenticated" || !session) return <PageLoading />;

  if (role && session.role !== role) {
    return (
      <Container className="py-16 text-center">
        <h1 className="text-xl font-semibold text-ink">This page is for {role}s</h1>
        <p className="mt-2 text-slate-600">You are signed in as a {session.role}.</p>
        <ButtonLink href={dashboardPath(session.role)} className="mt-6">
          Go to my dashboard
        </ButtonLink>
      </Container>
    );
  }

  return <>{children}</>;
}
