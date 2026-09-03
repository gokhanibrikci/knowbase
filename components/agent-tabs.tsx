import Link from "next/link";

/**
 * The agent side is two screens, not one long page: what to do to get started, and what
 * is actually happening in the store. They are siblings rather than a page and its
 * appendix, so they get a tab bar rather than a link buried at the bottom.
 */
const TABS = [
  { href: "/agents", label: "setup", hint: "how to wire it up" },
  { href: "/activity", label: "activity", hint: "who is here, what they decided" },
  { href: "/stats", label: "outcomes", hint: "repeat failures caught, engineer time" },
] as const;

export function AgentTabs({ current }: { current: (typeof TABS)[number]["href"] }) {
  return (
    <nav aria-label="Agent side" className="mt-5 flex items-end gap-1 border-b border-rule">
      {TABS.map((tab) => {
        const active = tab.href === current;
        return (
          <Link
            key={tab.href}
            href={tab.href}
            aria-current={active ? "page" : undefined}
            title={tab.hint}
            className={`-mb-px border-b-2 px-3 py-2 text-sm transition-colors ${
              active
                ? "border-accent text-ink-bright"
                : "border-transparent text-ink-dim hover:border-accent-soft hover:text-accent"
            }`}
          >
            <span className="select-none text-accent-soft">{active ? "> " : "  "}</span>
            {tab.label}
          </Link>
        );
      })}
    </nav>
  );
}
