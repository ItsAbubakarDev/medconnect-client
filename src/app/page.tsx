import Link from "next/link";

import { FeaturedDoctors } from "@/components/featured-doctors";
import { SearchBar } from "@/components/search-bar";
import { ButtonLink, Container } from "@/components/ui";
import { SPECIALTIES } from "@/lib/specialties";

const steps = [
  { title: "Find your doctor", text: "Search by name or specialty and compare experience and fees." },
  { title: "Book a time", text: "Pick an open slot. The doctor confirms your appointment." },
  { title: "Consult by video", text: "Join a secure video call from your dashboard — no app to install." },
];

const benefits = [
  { title: "Video consultations", text: "Private, in-browser video calls between you and your doctor only." },
  { title: "Real-time availability", text: "Only open slots are shown, so a booking can never clash." },
  { title: "Your appointments in one place", text: "Track confirmations, cancellations and doctor notes." },
];

export default function HomePage() {
  return (
    <>
      <section className="border-b border-slate-200 bg-brand-50">
        <Container className="py-14 sm:py-20">
          <div className="max-w-2xl">
            <p className="text-sm font-semibold uppercase tracking-wide text-brand-700">Online doctor booking</p>
            <h1 className="mt-3 text-3xl font-bold leading-tight text-ink sm:text-5xl">
              Find the right doctor and consult them by video
            </h1>
            <p className="mt-4 text-lg text-slate-600">
              Book appointments with experienced doctors and see them from home through a secure video call.
            </p>
          </div>
          <div className="mt-8 max-w-2xl">
            <SearchBar />
          </div>
        </Container>
      </section>

      <section>
        <Container className="py-12">
          <h2 className="text-2xl font-bold text-ink">Browse by specialty</h2>
          <div className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
            {SPECIALTIES.map((s) => (
              <Link
                key={s.label}
                href={`/doctors?specialty=${encodeURIComponent(s.query)}`}
                className="rounded-xl border border-slate-200 bg-white px-4 py-4 font-medium text-ink hover:border-brand-600 hover:bg-brand-50"
              >
                {s.label}
              </Link>
            ))}
          </div>
        </Container>
      </section>

      <section className="border-y border-slate-200 bg-slate-50">
        <Container className="py-12">
          <h2 className="text-2xl font-bold text-ink">How MedConnect works</h2>
          <ol className="mt-6 grid gap-4 sm:grid-cols-3">
            {steps.map((step, i) => (
              <li key={step.title} className="rounded-xl border border-slate-200 bg-white p-5">
                <span className="flex h-9 w-9 items-center justify-center rounded-full bg-brand-700 font-bold text-white">{i + 1}</span>
                <p className="mt-4 font-semibold text-ink">{step.title}</p>
                <p className="mt-1 text-sm text-slate-600">{step.text}</p>
              </li>
            ))}
          </ol>
        </Container>
      </section>

      <section>
        <Container className="py-12">
          <div className="flex items-end justify-between gap-4">
            <h2 className="text-2xl font-bold text-ink">Doctors on MedConnect</h2>
            <Link href="/doctors" className="text-sm font-semibold text-brand-700 hover:underline">
              View all doctors
            </Link>
          </div>
          <div className="mt-6">
            <FeaturedDoctors />
          </div>
        </Container>
      </section>

      <section className="border-t border-slate-200 bg-slate-50">
        <Container className="grid gap-4 py-12 sm:grid-cols-3">
          {benefits.map((b) => (
            <div key={b.title}>
              <p className="font-semibold text-ink">{b.title}</p>
              <p className="mt-1 text-sm text-slate-600">{b.text}</p>
            </div>
          ))}
        </Container>
      </section>

      <section>
        <Container className="py-12">
          <div className="flex flex-col items-start gap-4 rounded-2xl bg-brand-700 px-6 py-8 text-white sm:flex-row sm:items-center sm:justify-between sm:px-10">
            <div>
              <h2 className="text-2xl font-bold">Are you a doctor?</h2>
              <p className="mt-1 text-brand-100">Set your weekly hours once and consult patients online.</p>
            </div>
            <ButtonLink href="/register?role=doctor" variant="secondary" size="lg">
              Join as a doctor
            </ButtonLink>
          </div>
        </Container>
      </section>
    </>
  );
}
