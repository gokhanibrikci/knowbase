import Link from "next/link";

import { Tag, type Tone } from "@/components/ko/parts";
import { freshnessOf } from "@/lib/ko/store";
import type { KnowledgeObject } from "@/lib/ko/schema";

const CONFIDENCE_TONE: Record<string, Tone> = { high: "ok", medium: "warn", low: "bad" };

export function KoList({ objects }: { objects: KnowledgeObject[] }) {
  return (
    <ul className="divide-y divide-rule border-y border-rule">
      {objects.map((ko) => {
        const fresh = freshnessOf(ko);

        return (
          <li key={ko.slug} className="group py-4">
            <Link href={`/k/${ko.slug}`} className="block">
              <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                <h3 className="text-ink-bright group-hover:text-accent">{ko.title}</h3>
                <Tag tone={CONFIDENCE_TONE[ko.confidence]}>evidence: {ko.confidence}</Tag>
                {fresh.status !== "fresh" ? <Tag tone="warn">{fresh.status}</Tag> : null}
              </div>
              <p className="mt-1 text-sm text-ink-dim">{ko.summary}</p>
              <p className="mt-2 text-xs text-ink-faint">
                /k/{ko.slug} · {ko.domain} · {ko.evidence.length} sources · verified{" "}
                {fresh.verifiedAt}
                {ko.error.codes.length > 0 ? ` · ${ko.error.codes.join(" ")}` : ""}
              </p>
            </Link>
          </li>
        );
      })}
    </ul>
  );
}
