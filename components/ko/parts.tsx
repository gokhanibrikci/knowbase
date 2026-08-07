import type { ReactNode } from "react";

/** Section headings render their markdown marker so the page reads like the source. */
export function Section({
  title,
  id,
  children,
  hint,
}: {
  title: string;
  id: string;
  children: ReactNode;
  hint?: string;
}) {
  return (
    <section aria-labelledby={id} className="pt-7">
      <div className="rule" />
      <h2 id={id} className="mt-5 text-lg text-ink-bright">
        <span className="text-accent-soft select-none">## </span>
        {title}
        {hint ? <span className="ml-3 text-xs text-ink-faint">{hint}</span> : null}
      </h2>
      <div className="mt-3">{children}</div>
    </section>
  );
}

const TONES = {
  primary: "border-accent-soft text-accent",
  common: "border-rule text-ink",
  edge: "border-rule text-ink-dim",
  ok: "border-ok/40 text-ok",
  warn: "border-warn/40 text-warn",
  bad: "border-bad/40 text-bad",
  neutral: "border-rule text-ink-dim",
} as const;

export type Tone = keyof typeof TONES;

export function Tag({ tone = "neutral", children }: { tone?: Tone; children: ReactNode }) {
  return (
    <span
      className={`inline-block border px-1.5 py-px text-[0.6875rem] leading-normal uppercase tracking-wide ${TONES[tone]}`}
    >
      {children}
    </span>
  );
}

export function CommandBox({ children, prefix = "$" }: { children: string; prefix?: string }) {
  return (
    <pre className="mt-2 overflow-x-auto border border-rule bg-panel px-3 py-2 text-[0.8125rem] text-ink-bright">
      <code>
        {children.split("\n").map((line, i) => (
          <span key={i} className="block">
            {prefix ? <span className="select-none text-accent-soft">{prefix} </span> : null}
            {line}
          </span>
        ))}
      </code>
    </pre>
  );
}

export function CodeBox({ children, language }: { children: string; language?: string }) {
  return (
    <div className="mt-2">
      {language ? (
        <div className="border border-b-0 border-rule bg-panel-raised px-3 py-1 text-[0.6875rem] uppercase tracking-wide text-ink-faint">
          {language}
        </div>
      ) : null}
      <pre className="overflow-x-auto border border-rule bg-panel px-3 py-2 text-[0.8125rem] text-ink-bright">
        <code>{children}</code>
      </pre>
    </div>
  );
}

/**
 * The at-a-glance summary, rendered as a real `<table>`.
 *
 * Two reasons it is a table and not a definition list. Retrieval systems chunk a
 * page and cite disproportionately from its opening; a table near the top is a
 * self-contained chunk that answers the question without the surrounding prose. And
 * measured citation behaviour favours pages carrying at least one data table
 * alongside a numbered list — this page now has both.
 */
export function SummaryTable({ caption, children }: { caption: string; children: ReactNode }) {
  return (
    <table className="mt-6 w-full border-collapse text-sm">
      <caption className="sr-only">{caption}</caption>
      <tbody>{children}</tbody>
    </table>
  );
}

export function SummaryRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <tr className="align-top">
      <th
        scope="row"
        className="w-32 py-0.5 pr-3 text-left font-normal whitespace-nowrap text-ink-dim"
      >
        {label}
      </th>
      <td className="py-0.5 text-ink">{children}</td>
    </tr>
  );
}

/** Aligned `label : value` rows, the way a terminal tool prints its own header. */
export function MetaRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-x-2 sm:flex-row">
      <dt className="shrink-0 text-ink-dim sm:w-32">{label}</dt>
      <dd className="text-ink">{children}</dd>
    </div>
  );
}
