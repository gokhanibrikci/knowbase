import Link from "next/link";

import { site } from "@/lib/site";

export function SiteFooter() {
  return (
    <footer className="pb-10">
      <div className="rule-solid" />
      <div className="mt-4 flex flex-col gap-3 text-xs text-ink-dim sm:flex-row sm:items-center sm:justify-between">
        <nav className="flex flex-wrap items-center gap-x-4 gap-y-2">
          <Link href="/about" className="hover:text-accent">
            about
          </Link>
          <Link href="/llms.txt" className="hover:text-accent">
            llms.txt
          </Link>
          <Link href="/sitemap.xml" className="hover:text-accent">
            sitemap
          </Link>
          <a
            href="https://creativecommons.org/licenses/by/4.0/"
            rel="license noopener"
            className="hover:text-accent"
          >
            CC-BY-4.0
          </a>
        </nav>
        <span>
          {site.name} {site.version} — {site.tagline}
        </span>
      </div>
    </footer>
  );
}
