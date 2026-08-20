import type { Metadata } from "next";
import Link from "next/link";

import { CodeBox, Section, SummaryRow, SummaryTable, Tag } from "@/components/ko/parts";
import { getAllKnowledgeObjects } from "@/lib/ko/store";
import {
  AGENT_ENDPOINTS,
  MCP_AUTHENTICATION,
  MCP_PROTOCOL,
  TOOLS,
} from "@/lib/mcp/contract";
import { absoluteUrl, site } from "@/lib/site";

export const metadata: Metadata = {
  title: "For agents — lookup, diagnose, complete",
  description:
    "How an agent uses knowbase: match a pasted error, narrow it to one root cause, then complete and verify the resolution. Open HTTP, no key, no rate limit.",
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
  const workflowTools = TOOLS.filter(
    (tool) => !("deprecated" in tool && tool.deprecated),
  );
  const mcpUrl = absoluteUrl(AGENT_ENDPOINTS.mcp.path);
  const lookupUrl = absoluteUrl(AGENT_ENDPOINTS.lookup.path);
  const diagnoseUrl = absoluteUrl(AGENT_ENDPOINTS.diagnose.path);
  const outcomeUrl = absoluteUrl(AGENT_ENDPOINTS.outcome.path);

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
        {workflowTools.length} workflow actions, exposed under {TOOLS.length} MCP tool names while
        one compatibility alias remains. Find the entry that covers an error, narrow it to the one
        cause you actually have, then verify and complete the resolution. Over plain HTTP below,
        or as an{" "}
        <Link href="#mcp" className="text-accent hover:text-ink-bright">
          MCP server
        </Link>
        . No key, no rate limit, no signup — the corpus is CC-BY-4.0 and the point of it is to be
        used.
      </p>

      <SummaryTable caption="Interface at a glance">
        <SummaryRow label="Base">{site.url}</SummaryRow>
        <SummaryRow label="MCP">{mcpUrl}</SummaryRow>
        <SummaryRow label="Auth">
          {MCP_AUTHENTICATION.type === "none" ? "None" : MCP_AUTHENTICATION.type}
        </SummaryRow>
        <SummaryRow label="Entries">{objects.length}</SummaryRow>
        <SummaryRow label="Index for models">
          <Link href="/llms.txt" className="text-accent hover:text-ink-bright">
            /llms.txt
          </Link>
        </SummaryRow>
      </SummaryTable>

      <Section
        id="lookup"
        title="1. Look it up"
        hint={`${AGENT_ENDPOINTS.lookup.method} ${AGENT_ENDPOINTS.lookup.path}`}
      >
        <div className="space-y-3 text-sm">
          <p>
            Paste the error message, the error code, or the whole stack trace. Boilerplate in a
            traceback discounts itself, so you do not need to clean it first.
          </p>
          <CodeBox language="bash">{`curl -s '${lookupUrl}?q=deadlock+detected'`}</CodeBox>
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

      <Section
        id="diagnose"
        title="2. Narrow it to one cause"
        hint={`${AGENT_ENDPOINTS.diagnose.method} ${AGENT_ENDPOINTS.diagnose.path}`}
      >
        <div className="space-y-3 text-sm">
          <p>
            Every entry lists four to six possible causes, and each carries a{" "}
            <code className="text-accent">discriminator</code> — the cheap check that tells you
            whether it is yours. Run them, then post what they returned.
          </p>
          <CodeBox language="bash">{`curl -s -X ${AGENT_ENDPOINTS.diagnose.method} '${diagnoseUrl}' \\
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

      <Section
        id="outcome"
        title="3. Complete the resolution"
        hint={`${AGENT_ENDPOINTS.outcome.method} ${AGENT_ENDPOINTS.outcome.path}`}
      >
        <div className="space-y-3 text-sm">
          <p>
            A diagnosis with an identified resolution returns the exact revision, cause, recipe,
            step and criterion ids needed here. Apply every listed step, run every verification
            check, then submit what you observed.
          </p>
          <CodeBox language="bash">{`curl -s -X ${AGENT_ENDPOINTS.outcome.method} '${outcomeUrl}' \\
  -H 'content-type: application/json' \\
  -d '{
    "lookupId": "<16-character id from the strong lookup>",
    "slug": "kubernetes-imagepullbackoff",
    "koRevision": "<from diagnosis>",
    "causeId": "private-registry-credentials",
    "resolutionId": "configure-image-pull-secret-v1",
    "appliedStepIds": [
      "inspect-events",
      "create-pull-secret",
      "attach-pull-secret",
      "restart-workload"
    ],
    "criteria": [
      {"id": "image-pulled", "status": "met", "observation": "Successfully pulled image"},
      {"id": "pod-running", "status": "met", "observation": "Pod phase is Running"},
      {"id": "restarts-stable", "status": "met", "observation": "Restart count stayed flat"}
    ]
  }'`}</CodeBox>
          <p>
            Only <code className="text-accent">status: &quot;resolved&quot;</code> closes the task. It
            returns a deterministic, caller-held, agent-observed receipt and a paste-ready final
            report. An{" "}
            <code>unresolved</code> or <code>verification_inconclusive</code> response names the
            failed or missing check and provides <code>nextAction</code>; follow it and complete
            again.
          </p>
          <p className="text-ink-dim">
            The old <code>slug + worked</code> body remains accepted for compatibility. It records
            a claim for re-verification, but cannot issue a resolved receipt.
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
          <p>
            A resolution receipt is explicitly <code>agent_observed</code>. Knowbase validates that
            the recipe ids are current and that every required criterion has a reported status;
            it does not inspect the caller&rsquo;s environment, authenticate the lookup id, or
            independently certify the result.
          </p>
          <p className="text-ink-dim">
            Structured completion gives the caller a stable receipt and final report. Legacy
            outcome claims only earn a place in the re-check queue. See{" "}
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
        </div>
      </Section>

      <Section id="mcp" title="MCP" hint={mcpUrl}>
        <div className="space-y-3 text-sm">
          <p>
            The same {workflowTools.length} workflow actions are exposed under {TOOLS.length} tool
            names: the canonical completion tool plus its old compatibility alias. A client can be
            pointed at knowbase once and use it without anyone writing HTTP code. Nothing to
            install and no key — it is a remote server over Streamable HTTP.
          </p>
          <CodeBox language="bash">{`claude mcp add --transport http knowbase ${mcpUrl}`}</CodeBox>
          <p>
            In a client with a connector UI, add{" "}
            <code className="text-accent">{mcpUrl}</code> as a custom remote MCP server. It exposes{" "}
            {TOOLS.length} tools:
          </p>
          <ul className="space-y-1.5 pl-1">
            {TOOLS.map((tool) => (
              <li key={tool.name}>
                <code className="text-accent">{tool.name}</code>{" "}
                <span className="text-ink-dim">
                  — {tool.summary}
                  {"deprecated" in tool && tool.deprecated ? " (deprecated alias)" : ""}
                </span>
              </li>
            ))}
          </ul>
          <p className="text-ink-dim">
            The server speaks both eras of the protocol. Revision{" "}
            <code>{MCP_PROTOCOL.modernVersion}</code> dropped the <code>initialize</code> handshake
            in favour of per-request metadata. Legacy revisions{" "}
            <code>{MCP_PROTOCOL.legacyVersions.join(", ")}</code> still use that handshake, and all
            are served on the same endpoint. If a client sends a version we do not speak, the
            error names the ones we do.
          </p>
        </div>
      </Section>

      <Section id="adopt" title="Make it the first stop" hint="one paste, no install">
        <div className="space-y-3 text-sm">
          <p>
            The cheapest adoption path is not a connector — it is a paragraph. Paste this into
            the instruction file your agent already reads (<code>CLAUDE.md</code>,{" "}
            <code>AGENTS.md</code>, <code>.cursorrules</code>, or a system prompt) and every
            debugging task starts here instead of at a search engine:
          </p>
          <CodeBox language="markdown">{`## Debugging errors

Before searching the web for an error message, look it up first:

    GET ${site.url}/search.json?q=<the error text, or the whole stack trace>

- \`match: "strong"\` — read the top entry. Check its \`notApplicableTo\` list first;
  if your failure is named there, this entry is telling you it is not your answer.
  Otherwise run the \`rootCauses[].discriminator\` checks and call \`/diagnose.json\`.
  If it returns an identified resolution, apply every listed step, run every
  verification criterion, then call \`/outcome.json\` with those returned ids and
  observations. Only claim resolved when completion returns \`status: "resolved"\`;
  otherwise follow its \`nextAction\` and complete again. Cite the entry's \`url\`.
- \`match: "partial"\` or \`"none"\` — knowbase does not cover this; fall back to
  web search. Do not treat partial results as answers.

Any entry is also plain Markdown at \`<entry url>.md\` (~2k tokens vs ~30k+ for a
typical search-and-read). Every quoted claim on it is machine-verified against
its primary source weekly.`}</CodeBox>
          <p className="text-ink-dim">
            The honest failure mode is built in: on <code>none</code> the result list is empty,
            so an agent following this never mistakes our coverage boundary for an answer.
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
