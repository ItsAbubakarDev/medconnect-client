import Link from "next/link";

import { Logo } from "./logo";
import { Container } from "./ui";

export function Footer() {
  return (
    <footer className="mt-16 border-t border-slate-200 bg-slate-50">
      <Container className="grid gap-8 py-10 sm:grid-cols-3">
        <div className="space-y-3">
          <Logo />
          <p className="text-sm text-slate-600">Book verified doctors and consult them by video, from anywhere.</p>
        </div>
        <div>
          <p className="text-sm font-semibold text-ink">For patients</p>
          <ul className="mt-3 space-y-2 text-sm text-slate-600">
            <li>
              <Link href="/doctors" className="hover:text-brand-700">
                Find a doctor
              </Link>
            </li>
            <li>
              <Link href="/register" className="hover:text-brand-700">
                Create an account
              </Link>
            </li>
          </ul>
        </div>
        <div>
          <p className="text-sm font-semibold text-ink">For doctors</p>
          <ul className="mt-3 space-y-2 text-sm text-slate-600">
            <li>
              <Link href="/register?role=doctor" className="hover:text-brand-700">
                Join MedConnect
              </Link>
            </li>
            <li>
              <Link href="/login" className="hover:text-brand-700">
                Doctor login
              </Link>
            </li>
          </ul>
        </div>
      </Container>
      <div className="border-t border-slate-200 py-4 text-center text-xs text-slate-500">MedConnect · Final Year Project</div>
    </footer>
  );
}
