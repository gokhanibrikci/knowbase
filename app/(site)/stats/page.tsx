import type { Metadata } from "next";
import Link from "next/link";

import { AgentTabs } from "@/components/agent-tabs";
import { isPrivate, orgName, site } from "@/lib/site";
import { storeDb } from "@/lib/xp/agents";
import { type Outcomes, loadOutcomes } from "@/lib/xp/stats";

export const metadata: Metadata = {
  title: "Outcomes",
  description:
    "How many repeat failures the store caught, and how much engineer time that stood for, counted rather than estimated.",
  alternates: { canonical: "/stats" },
};

export const dynamic = "force-dynamic";

function hours(minutes: number): string {
  if (minutes < 60) return `${minutes} min`;
  const h = minutes / 60;
  return `${h >= 10 ? Math.round(h) : h.toFixed(1)} h`;
}

function Figure({ n, label, hint }: { n: string; label: string; hint?: string }) {
  return (
    <div className="rounded border border-rule px-4 py-3">
      <div className="text-2xl text-ink-bright">{n}</div>
      <div className="text-sm text-ink">{label}</div>
      {hint ? <div className="mt-1 text-xs text-ink-dim">{hint}</div> : null}
    </div>
  );
}

export default async function StatsPage() {
  const db = storeDb();
  const days = 30;
  const o: Outcomes | null = db ? await loadOutcomes(db, days) : null;
  const priv = isPrivate();

  return (
    <div className="pt-6">
      <nav aria-label="Breadcrumb" className="text-xs text-ink-dim">
        <Link href="/" className="hover:text-accent">
          {site.name}
        </Link>
        <span className="mx-1">/</span>
        <span>outcomes</span>
      </nav>
      <h1 className="mt-2 text-xl text-ink-bright">
        {priv ? `What this knowbase did for ${orgName()}` : "What the store did"}
      </h1>
      <p className="mt-1 text-sm text-ink-dim">
        Last {days} days. Counted from what happened, never estimated from token prices.
      </p>
      <AgentTabs current="/stats" />

      {!o ? (
        <p className="mt-6 text-sm text-ink-dim">The store is not reachable from here.</p>
      ) : (
        <>
          <section className="mt-6 grid gap-3 sm:grid-cols-3">
            <Figure
              n={String(o.repeatFailuresCaught)}
              label="repeat failures caught"
              hint="a failure somebody had already fixed, met again, fix handed over"
            />
            <Figure
              n={
                o.engineerMinutes.measured + o.engineerMinutes.borrowed > 0
                  ? hours(o.engineerMinutes.saved)
                  : "—"
              }
              label="engineer time behind them"
              hint={
                o.engineerMinutes.measured + o.engineerMinutes.borrowed > 0
                  ? `${o.engineerMinutes.measured} clocked, ${o.engineerMinutes.borrowed} at the median${
                      o.engineerMinutes.medianMinutes !== null
                        ? ` (${o.engineerMinutes.medianMinutes} min)`
                        : ""
                    }${o.engineerMinutes.unvalued ? `, ${o.engineerMinutes.unvalued} unvalued` : ""}`
                  : "nothing has been clocked yet — the first ask-then-report starts the clock"
              }
            />
            <Figure
              n={String(o.fixesConfirmedFromMemory)}
              label="handed-over fixes confirmed"
              hint="the agent reported back that the stored fix worked"
            />
          </section>

          <section className="mt-6 grid gap-3 text-sm sm:grid-cols-4">
            <Figure n={String(o.recalls)} label="recalls" />
            <Figure n={String(o.misses)} label="misses" hint="nothing known yet; now on the unanswered list" />
            <Figure n={String(o.questionsAnswered)} label="questions answered" />
            <Figure
              n={String(o.deadEndsRecorded)}
              label="dead ends recorded"
              hint="attempts that failed, so the next agent skips them"
            />
          </section>

          {o.top.length > 0 ? (
            <section className="mt-8">
              <h2 className="text-sm text-ink-bright">Met again most often</h2>
              <table className="mt-2 w-full text-sm">
                <thead className="text-left text-xs text-ink-dim">
                  <tr>
                    <th className="py-1 font-normal">failure</th>
                    <th className="py-1 text-right font-normal">hits</th>
                    <th className="py-1 text-right font-normal">time behind them</th>
                  </tr>
                </thead>
                <tbody>
                  {o.top.map((t) => (
                    <tr key={t.problemId} className="border-t border-rule">
                      <td className="py-1.5 pr-3">
                        <Link href={`/p/${t.problemId}`} className="hover:text-accent">
                          {t.title}
                        </Link>
                      </td>
                      <td className="py-1.5 text-right tabular-nums">{t.hits}</td>
                      <td className="py-1.5 text-right tabular-nums text-ink-dim">
                        {t.minutes === null ? "—" : hours(t.minutes)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </section>
          ) : null}

          <section className="mt-8 text-xs leading-relaxed text-ink-dim">
            <h2 className="text-sm text-ink-bright">How these are counted</h2>
            <p className="mt-1">{o.method}</p>
            <p className="mt-1">
              Machine-readable at <code>/stats.json?days=30</code>
              {priv ? ", with your secret in the Authorization header" : ""}.
            </p>
          </section>
        </>
      )}
    </div>
  );
}
