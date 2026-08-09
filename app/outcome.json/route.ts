import { SCHEMA_VERSION } from "@/lib/ko/serialize";
import { getKnowledgeObject } from "@/lib/ko/store";
import { logReport } from "@/lib/query-log";
import { absoluteUrl, site } from "@/lib/site";

/**
 * Whether the fix held.
 *
 * Kept as small as it is on purpose. The signal is weak and we know why: there is no
 * attribution (the agent may have solved it from its own weights and called anyway),
 * only successes tend to come back, and nothing here is verifiable. So it is recorded
 * as a lead for re-verification and nothing else.
 *
 * In particular it does not touch `confidence`. Usage is popularity, not evidence,
 * and a second path to the same label would empty the label of meaning. What this
 * does earn is a place in the re-check queue: an entry collecting "did not work"
 * against a specific version is worth a human reading its sources again.
 *
 * The schema is the part of the design most likely to be wrong, which is why it is
 * three fields. It will be rewritten once there is data to shape it.
 */

const MAX_NOTE = 2000;

const CORS = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "POST, OPTIONS",
  "access-control-allow-headers": "content-type",
  "cache-control": "no-store",
} as const;

function usage(status: number, error?: string) {
  return Response.json(
    {
      schemaVersion: SCHEMA_VERSION,
      ...(error ? { error } : {}),
      usage: {
        endpoint: absoluteUrl("/outcome.json"),
        method: "POST",
        body: {
          lookupId: "optional. The id from the /search.json response.",
          slug: "required. The entry you applied.",
          worked: "required. Boolean.",
          note: "optional. What differed — a version, a platform, a step that did not apply.",
        },
        effect:
          "Ranks this entry for re-verification. It cannot raise or lower the entry's stated confidence, which is gated on evidence.",
      },
      license: "CC-BY-4.0",
      source: site.url,
    },
    { status, headers: CORS },
  );
}

export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return usage(400, "body must be JSON");
  }

  const { lookupId, slug, worked, note } = (body ?? {}) as Record<string, unknown>;

  if (typeof slug !== "string" || !slug) return usage(400, "missing required field: slug");
  if (typeof worked !== "boolean") return usage(400, "field 'worked' must be a boolean");

  const ko = getKnowledgeObject(slug);
  if (!ko) return usage(404, `no entry with id: ${slug}`);

  logReport(
    {
      kind: "outcome",
      lookupId: typeof lookupId === "string" ? lookupId.slice(0, 32) : "",
      slug: ko.slug,
      worked,
      note: typeof note === "string" ? note.slice(0, MAX_NOTE) : "",
    },
    request.headers.get("user-agent") ?? "",
  );

  return Response.json(
    {
      schemaVersion: SCHEMA_VERSION,
      recorded: true,
      id: ko.slug,
      effect: worked
        ? "Recorded. This does not raise the entry's confidence — that is gated on evidence, not on use."
        : "Recorded, and queued for re-verification against its sources.",
      license: "CC-BY-4.0",
      source: site.url,
    },
    { headers: CORS },
  );
}

export function GET() {
  return usage(405, "use POST");
}

export function OPTIONS() {
  return new Response(null, { status: 204, headers: CORS });
}
