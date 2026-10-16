"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import type { FormEvent } from "react";

import { Button } from "./ui";

/** Searches doctors by name. Specialty filtering is done with the specialty shortcuts. */
export function SearchBar({ initialQuery = "", specialty }: { initialQuery?: string; specialty?: string }) {
  const router = useRouter();
  const [query, setQuery] = useState(initialQuery);

  function submit(e: FormEvent) {
    e.preventDefault();
    const params = new URLSearchParams();
    if (query.trim()) params.set("q", query.trim());
    if (specialty) params.set("specialty", specialty);
    router.push(`/doctors${params.size ? `?${params}` : ""}`);
  }

  return (
    <form onSubmit={submit} role="search" className="flex w-full gap-2">
      <label htmlFor="doctor-search" className="sr-only">
        Search doctors by name
      </label>
      <input
        id="doctor-search"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="Search doctors by name, e.g. Dr. Ayesha"
        className="min-w-0 flex-1 rounded-lg border border-slate-300 bg-white px-4 py-3 text-ink placeholder:text-slate-400 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-700"
      />
      <Button type="submit" size="lg">
        Search
      </Button>
    </form>
  );
}
