import Link from "next/link";

export function Logo() {
  return (
    <Link href="/" className="flex items-center gap-2 text-lg font-bold text-ink">
      <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-brand-700 text-white" aria-hidden>
        <svg viewBox="0 0 24 24" className="h-5 w-5" fill="currentColor">
          <path d="M10 4h4v6h6v4h-6v6h-4v-6H4v-4h6z" />
        </svg>
      </span>
      <span>
        Med<span className="text-brand-700">Connect</span>
      </span>
    </Link>
  );
}
