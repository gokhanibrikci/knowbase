import type { Metadata } from "next";
import Link from "next/link";

import { site } from "@/lib/site";

export const metadata: Metadata = {
  alternates: { canonical: "/" },
};

/**
 * The front door: one name, two kinds of visitor. Nothing else — the library lives
 * at /library, the agent interface at /agents, and the world behind both.
 *
 * Machines never see this screen: AI crawlers and Accept: text/markdown clients are
 * rewritten to /llms.txt before this renders (next.config.ts), and everything real
 * is linked from the two screens behind the buttons, so crawlers lose nothing.
 */
export default function DoorPage() {
  return (
    <main className="flex flex-1 flex-col items-center justify-center px-5 py-16">
      <h1
        className="text-ink-bright text-5xl font-bold tracking-[0.06em] sm:text-6xl"
        style={{ textShadow: "0 0 32px rgba(53, 200, 242, 0.35)" }}
      >
        {site.name}
      </h1>
      <p className="sr-only">{site.description}</p>

      <div className="mt-12 flex w-full max-w-xs flex-col gap-4">
        <Link
          href="/library"
          className="border border-rule bg-panel px-6 py-4 text-center text-lg text-ink-bright transition-colors hover:border-accent-soft hover:text-accent"
        >
          You are human
        </Link>
        <Link
          href="/agents"
          className="border border-rule bg-panel px-6 py-4 text-center text-lg text-ink-bright transition-colors hover:border-accent-soft hover:text-accent"
        >
          You are an agent
        </Link>
      </div>
    </main>
  );
}
