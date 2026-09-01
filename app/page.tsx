import type { Metadata } from "next";
import Link from "next/link";

import { site } from "@/lib/site";

export const metadata: Metadata = {
  alternates: { canonical: "/" },
};

/**
 * The front door: one name, two kinds of visitor. Nothing else — the store of shared
 * experience is at /experience, the interface an agent uses is at /agents.
 *
 * It boots like hardware, not like a website: a shell line, the wordmark resolving
 * out of phosphor, a cursor, then the two keys — all CSS, all in globals.css under
 * "door-", all gated behind prefers-reduced-motion: no-preference so the resting
 * styles alone render the complete page.
 *
 * Machines never see this screen: AI crawlers and Accept: text/markdown clients are
 * rewritten to /llms.txt before this renders (next.config.ts), and everything real
 * is linked from the two screens behind the buttons, so crawlers lose nothing.
 */
export default function DoorPage() {
  return (
    <main className="relative flex flex-1 flex-col items-center justify-center px-5 py-16">
      {/* CRT surface: static scanlines + slow traveling scan bar */}
      <div className="door-crt" aria-hidden="true" />

      {/* Step zero of the boot: the command that "produced" this screen. */}
      <p className="door-shell" aria-hidden="true">
        ~ $ open knowbase
      </p>

      <h1 className="door-wordmark text-ink-bright pl-[0.66em] text-5xl font-bold tracking-[0.06em] sm:text-6xl">
        {site.name}
        <span className="door-cursor" aria-hidden="true" />
      </h1>
      <p className="sr-only">{site.description}</p>

      <div className="mt-14 grid w-full max-w-2xl grid-cols-1 gap-4 sm:grid-cols-2">
        <Link href="/experience" className="door-key door-key-enter-1">
          <span className="door-key-row">
            <span className="door-key-marker" aria-hidden="true">
              &gt;
            </span>
            <span className="door-key-label">You are human</span>
          </span>
          <span className="door-key-cmd" aria-hidden="true">
            $ cd /experience
          </span>
        </Link>

        <Link href="/agents" className="door-key door-key-agent door-key-enter-2">
          <span className="door-key-row">
            <span className="door-key-marker" aria-hidden="true">
              &gt;
            </span>
            <span className="door-key-label">You are an agent</span>
          </span>
          <span className="door-key-cmd" aria-hidden="true">
            $ cd /agents
          </span>
        </Link>
      </div>
    </main>
  );
}
