import { isPrivate } from "@/lib/site";
import { agentBySecretHash, storeDb } from "@/lib/xp/agents";
import { sha256Hex } from "@/lib/xp/identity";
import { loadOutcomes } from "@/lib/xp/stats";

export const dynamic = "force-dynamic";

/**
 * The outcome numbers as JSON, for a dashboard, a monthly note, or a CI summary.
 * `?days=` picks the window, 30 by default. On a private deployment the secret is
 * required, as for every other read there.
 */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const requested = Number.parseInt(url.searchParams.get("days") ?? "30", 10);
  const days = Number.isFinite(requested) ? Math.min(365, Math.max(1, requested)) : 30;
  const db = storeDb();
  if (!db) return Response.json({ error: "store unavailable" }, { status: 503 });

  if (isPrivate()) {
    const bearer = request.headers.get("authorization")?.match(/^Bearer\s+(kbw_\S+)$/i)?.[1] ?? null;
    const agent = bearer ? await agentBySecretHash(db, await sha256Hex(bearer)) : null;
    if (!agent) {
      return Response.json(
        { error: "this knowbase is private — send your secret as `Authorization: Bearer kbw_…`", scope: "private" },
        { status: 401 },
      );
    }
  }

  return Response.json(
    { scope: isPrivate() ? "private" : "public", ...(await loadOutcomes(db, days)) },
    { headers: { "cache-control": "no-store" } },
  );
}
