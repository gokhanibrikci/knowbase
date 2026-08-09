import type { Metadata } from "next";
import Link from "next/link";

import { CodeBox, Section, SummaryRow, SummaryTable, Tag } from "@/components/ko/parts";
import { getAllKnowledgeObjects } from "@/lib/ko/store";
import { site } from "@/lib/site";

export const metadata: Metadata = {
  title: "For agents — lookup, diagnose, report",
  description:
    "How an agent uses knowbase: match a pasted error against the corpus, narrow it to one root cause, and report what happened. Open HTTP, no key, no rate limit.",
  alternates: { canonical: "/agents" },
};

/**
 * The interface, written for the person deciding whether to point their agent at it.
 *
 * Everything here is already discoverable by a model through llms.txt. None of it was
 * discoverable by a human, which meant the only people who could evaluate the thing
 * were the ones already reading the repository.
 */
export default function AgentsPage() {
  const objects = getAllKnowledgeObjects();

  return (
    <div className="pt-6">
      <nav aria-label="Breadcrumb" className="text-xs text-ink-dim">
        <Link href="/" className="hover:text-accent">
          {site.name}
        </Link>
        <span className="mx-2 text-ink-faint">&gt;</span>
        <span className="text-ink">agents</span>
      </nav>

      <h1 className="mt-5 text-2xl text-ink-bright">
        <span className="select-none text-accent-soft"># </span>
        For agents
      </h1>
      <p className="mt-3 text-ink">
        Three endpoints. Find the entry that covers an error, narrow it to the one cause you
        actually have, and say what happened. No key, no rate limit, no signup — the corpus is
        CC-BY-4.0 and the point of it is to be used.
      </p>

      <SummaryTable caption="Interface at a glance">
        <SummaryRow label="Base">{site.url}</SummaryRow>
        <SummaryRow label="Auth">None</SummaryRow>
        <SummaryRow label="Entries">{objects.length}</SummaryRow>
        <SummaryRow label="Index for models">
          <Link href="/llms.txt" className="text-accent hover:text-ink-bright">
            /llms.txt
          </Link>
        </SummaryRow>
      </SummaryTable>

      <Section id="lookup" title="1. Look it up" hint="GET /search.json">
        <div className="space-y-3 text-sm">
          <p>
            Paste the error message, the error code, or the whole stack trace. Boilerplate in a
            traceback discounts itself, so you do not need to clean it first.
          </p>
          <CodeBox language="bash">{`curl -s '${site.url}/search.json?q=deadlock+detected'`}</CodeBox>
          <p>
            The response carries a <code className="text-accent">match</code> field:
          </p>
          <ul className="space-y-1.5 pl-1">
            <li>
              <Tag tone="ok">strong</Tag>{" "}
              <span className="text-ink-dim">
                — one entry covers this. Read its <code>notApplicableTo</code> before applying it.
              </span>
            </li>
            <li>
              <Tag tone="warn">partial</Tag>{" "}
              <span className="text-ink-dim">
                — related, but may be a different failure. Leads to verify, not the answer.
              </span>
            </li>
            <li>
              <Tag tone="bad">none</Tag>{" "}
              <span className="text-ink-dim">
                — not covered here. The result list is empty on purpose.
              </span>
            </li>
          </ul>
          <p className="text-ink-dim">
            On <code>none</code> we return nothing rather than the closest entry. A near-miss answer
            to a production failure is worse than no answer, and an agent being told plainly that a
            source does not cover something is more useful than a confident guess.
          </p>
        </div>
      </Section>

      <Section id="diagnose" title="2. Narrow it to one cause" hint="POST /diagnose.json">
        <div className="space-y-3 text-sm">
          <p>
            Every entry lists four to six possible causes, and each carries a{" "}
            <code className="text-accent">discriminator</code> — the cheap check that tells you
            whether it is yours. Run them, then post what they returned.
          </p>
          <CodeBox language="bash">{`curl -s -X POST '${site.url}/diagnose.json' \\
  -H 'content-type: application/json' \\
  -d '{
    "lookupId": "<from the lookup response>",
    "slug": "kubernetes-imagepullbackoff",
    "observations": "Events show 401 Unauthorized and pull access denied"
  }'`}</CodeBox>
          <p>
            You get back the one cause your observations identify, and the ruled-out causes each
            paired with the check that rules it out — which the lookup alone cannot tell you. When
            nothing leads clearly the answer is{" "}
            <code className="text-accent">identified: null</code>, with the candidates ordered by
            fit.
          </p>
          <p className="text-ink-dim">
            This is the call worth making. Documentation everywhere lists what <em>can</em> cause an
            error; nothing records which cause actually fires, or how often. That only exists where
            the checks get run.
          </p>
        </div>
      </Section>

      <Section id="outcome" title="3. Say what happened" hint="POST /outcome.json">
        <div className="space-y-3 text-sm">
          <CodeBox language="bash">{`curl -s -X POST '${site.url}/outcome.json' \\
  -H 'content-type: application/json' \\
  -d '{"slug": "kubernetes-imagepullbackoff", "worked": true}'`}</CodeBox>
          <p>
            Optional, and deliberately thin. The signal is weak and we know why: there is no way to
            tell whether the entry solved it or you already knew, failures under-report worse than
            successes, and none of it is verifiable.
          </p>
        </div>
      </Section>

      <Section id="boundary" title="What reporting cannot do">
        <div className="space-y-3 text-sm">
          <p>
            Nothing posted to either endpoint can raise or lower an entry&rsquo;s stated{" "}
            <code className="text-accent">confidence</code>. That label is gated on evidence —
            source count and source type — and a second, weaker path to the same label would empty
            it of meaning. Usage is popularity, not proof.
          </p>
          <p className="text-ink-dim">
            What reports do earn is a place in the queue: which entry gets re-checked against its
            sources, and which failure gets written up next. See{" "}
            <Link href="/about" className="text-accent hover:text-ink-bright">
              the method
            </Link>{" "}
            for how confidence is actually assigned.
          </p>
        </div>
      </Section>

      <Section id="formats" title="Other ways in">
        <div className="space-y-3 text-sm">
          <p>
            Any entry is available as JSON, Markdown or plain text by appending an extension —{" "}
            <code>/k/&lt;slug&gt;.json</code>, <code>.md</code>, <code>.txt</code> — and{" "}
            <code>Accept: text/markdown</code> on the HTML URL returns the Markdown twin. For a
            single fetch of everything, use{" "}
            <Link href="/llms-full.txt" className="text-accent hover:text-ink-bright">
              /llms-full.txt
            </Link>
            .
          </p>
          <p className="text-ink-dim">
            An MCP server is not published yet. It would be a thin wrapper over these three calls,
            so nothing here changes when it lands — code written against this interface keeps
            working. Until then any agent with HTTP can use knowbase, which is why the endpoints
            came first.
          </p>
        </div>
      </Section>

      <Section id="stability" title="Stability">
        <div className="space-y-3 text-sm">
          <p>
            Every JSON body carries <code className="text-accent">schemaVersion</code>. Fields get
            added; existing ones will not change meaning under you. The endpoints answer{" "}
            <code>OPTIONS</code> and send <code>access-control-allow-origin: *</code>, so they work
            from a browser as well as a server.
          </p>
          <p className="text-ink-dim">
            Requests are logged: the query, the verdict, which entry we pointed at, and the
            user-agent. Queries are truncated and patterns that look like tokens, passwords or
            credentials in a connection string are stripped before storage.
          </p>
        </div>
      </Section>
    </div>
  );
}
