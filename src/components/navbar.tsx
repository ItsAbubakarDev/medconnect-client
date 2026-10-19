"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { Suspense, useState } from "react";

import { useAuth } from "@/lib/auth";
import { useIsClient } from "@/lib/use-is-client";

import { ConfirmDialog } from "./confirm-dialog";
import { Logo } from "./logo";
import { NotificationBell } from "./notifications";
import { Button, ButtonLink, Container } from "./ui";

const linksByRole = {
  anonymous: [{ href: "/doctors", label: "Find doctors" }],
  patient: [
    { href: "/doctors", label: "Find doctors" },
    { href: "/patient", label: "My appointments" },
    { href: "/patient/history", label: "Health record" },
    { href: "/patient/profile", label: "Profile" },
  ],
  doctor: [
    { href: "/doctor", label: "Dashboard" },
    { href: "/doctor/availability", label: "Availability" },
    { href: "/doctor/reviews", label: "Reviews" },
    { href: "/doctor/profile", label: "Profile" },
  ],
};

type NavItem = { href: string; label: string };

function NavLinkList({ links, activePath, onNavigate }: { links: NavItem[]; activePath: string | null; onNavigate: () => void }) {
  return links.map((l) => (
    <Link
      key={l.href}
      href={l.href}
      onClick={onNavigate}
      className={`rounded-md px-3 py-2 text-sm font-medium ${activePath === l.href ? "bg-brand-50 text-brand-800" : "text-slate-700 hover:bg-slate-100"}`}
    >
      {l.label}
    </Link>
  ));
}

function ActiveNavLinks(props: { links: NavItem[]; onNavigate: () => void }) {
  return <NavLinkList {...props} activePath={usePathname()} />;
}

export function Navbar() {
  const { status, session, displayName, logout } = useAuth();
  const router = useRouter();
  const isClient = useIsClient();
  const [open, setOpen] = useState(false);
  const [confirmingLogout, setConfirmingLogout] = useState(false);

  const links = session ? linksByRole[session.role] : linksByRole.anonymous;
  const close = () => setOpen(false);

  async function handleLogout() {
    await logout();
    setConfirmingLogout(false);
    setOpen(false);
    router.push("/");
  }

  // usePathname() is only read after mount, in a freshly mounted subtree. Reading it while
  // hydrating made the navbar suspend under Cache Components, and the auth state arriving
  // during that suspension made React discard the server HTML (React error #418).
  const plainLinks = <NavLinkList links={links} activePath={null} onNavigate={close} />;
  const navLinks = isClient ? (
    <Suspense fallback={plainLinks}>
      <ActiveNavLinks links={links} onNavigate={close} />
    </Suspense>
  ) : (
    plainLinks
  );

  const accountArea =
    status === "loading" ? null : session ? (
      <div className="flex items-center gap-3">
        <span className="hidden text-sm text-slate-600 lg:inline">
          {displayName ?? (session.role === "doctor" ? "Doctor" : "Patient")}
        </span>
        <Button variant="secondary" size="sm" onClick={() => setConfirmingLogout(true)}>
          Log out
        </Button>
      </div>
    ) : (
      <div className="flex items-center gap-2">
        <ButtonLink href="/login" variant="ghost" size="sm" onClick={() => setOpen(false)}>
          Log in
        </ButtonLink>
        <ButtonLink href="/register" size="sm" onClick={() => setOpen(false)}>
          Sign up
        </ButtonLink>
      </div>
    );

  return (
    <header className="border-b border-slate-200 bg-white">
      <Container className="flex h-16 items-center justify-between gap-4">
        <Logo />
        <nav className="hidden items-center gap-1 md:flex">{navLinks}</nav>
        <div className="flex items-center gap-2 md:gap-3">
          {/* Outside the mobile menu, so the unread count is always in view. */}
          {session && <NotificationBell />}
          <div className="hidden md:block">{accountArea}</div>
          <button
            type="button"
            className="rounded-md border border-slate-300 px-3 py-1.5 text-sm font-medium text-ink md:hidden"
            aria-expanded={open}
            onClick={() => setOpen((o) => !o)}
          >
            {open ? "Close" : "Menu"}
          </button>
        </div>
      </Container>
      {open && (
        <div className="border-t border-slate-200 md:hidden">
          <Container className="flex flex-col gap-1 py-3">
            {navLinks}
            <div className="mt-2 border-t border-slate-200 pt-3">{accountArea}</div>
          </Container>
        </div>
      )}
      {confirmingLogout && (
        <ConfirmDialog
          title="Log out?"
          confirmLabel="Log out"
          busyLabel="Logging out…"
          cancelLabel="Stay logged in"
          onConfirm={handleLogout}
          onClose={() => setConfirmingLogout(false)}
        >
          <p>You&apos;ll need your email and password to log in again.</p>
        </ConfirmDialog>
      )}
    </header>
  );
}

