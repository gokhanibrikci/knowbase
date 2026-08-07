import Link from "next/link";

import { site } from "@/lib/site";

/**
 * Search is a plain GET form on purpose: it works with JavaScript disabled, it is
 * crawlable, and the query lands in the URL so a result set can be linked to.
 */
export function SiteHeader() {
  return (
    <header className="pt-8 sm:pt-10">
      <div className="flex flex-col gap-5 sm:flex-row sm:items-center sm:justify-between sm:gap-8">
        <Link
          href="/"
          className="text-ink-bright text-3xl font-bold tracking-[0.06em] sm:text-4xl hover:text-accent transition-colors"
          style={{ textShadow: "0 0 24px rgba(53, 200, 242, 0.3)" }}
        >
          {site.name}
        </Link>

        <form action="/search" method="get" role="search" className="w-full sm:max-w-md">
          <label htmlFor="q" className="sr-only">
            Search {site.name}
          </label>
          <div className="flex items-center gap-2 border border-rule bg-panel px-3 py-2 focus-within:border-accent-soft">
            <input
              id="q"
              name="q"
              type="search"
              autoComplete="off"
              placeholder="search knowbase..."
              className="w-full bg-transparent text-ink placeholder:text-ink-faint focus:outline-none"
            />
            <button type="submit" aria-label="Search" className="text-accent hover:text-ink-bright">
              <svg
                width="15"
                height="15"
                viewBox="0 0 15 15"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.4"
                aria-hidden="true"
              >
                <circle cx="6.4" cy="6.4" r="4.6" />
                <path d="M10 10l3.4 3.4" strokeLinecap="round" />
              </svg>
            </button>
          </div>
        </form>
      </div>

      <div className="rule-solid mt-6" />
    </header>
  );
}
