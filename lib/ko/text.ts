/**
 * Fetching and normalising source documents.
 *
 * Shared by the quote-grounding gate and by source acquisition, because both need
 * the *same* notion of "what this page says". If they normalised differently, a
 * quote lifted during research could fail verification for reasons that have
 * nothing to do with whether the source supports the claim.
 */

const UA = "Mozilla/5.0 (compatible; knowbase-source-reader/0.1; +https://knowbase.sh)";
const TIMEOUT_MS = 30_000;

export async function fetchPage(url: string, timeoutMs = TIMEOUT_MS): Promise<string> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      redirect: "follow",
      signal: controller.signal,
      headers: { "user-agent": UA, accept: "text/html,application/xhtml+xml,text/markdown,*/*" },
    });
    return await res.text();
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Several vendors publish a markdown twin of each docs page. Where one exists it is
 * one to two orders of magnitude smaller than the HTML — measured on 2026-08-07,
 * Stripe's rate-limits page is ~189k tokens of HTML against ~3k of markdown. Worth
 * probing before falling back to parsing HTML.
 */
export function markdownTwin(url: string): string | null {
  const u = new URL(url);
  if (/\.(md|txt)$/.test(u.pathname)) return null;
  if (!/^(docs\.stripe\.com|nextjs\.org|docs\.docker\.com)$/.test(u.hostname)) return null;
  u.hash = "";
  u.pathname = `${u.pathname.replace(/\/$/, "")}.md`;
  return u.toString();
}

/** Applied to both a quote and a page, so typographic drift cannot cause a miss. */
export function fold(s: string): string {
  let out = s.normalize("NFKC");
  const pairs: [RegExp, string][] = [
    [/[‘’‛]/g, "'"],
    [/[“”‟]/g, '"'],
    [/—/g, "--"],
    [/–/g, "-"],
    [/[   ]/g, " "],
    [/−/g, "-"],
  ];
  for (const [re, to] of pairs) out = out.replace(re, to);
  return out;
}

const NAMED_ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
  mdash: "—",
  ndash: "–",
  hellip: "…",
  rsquo: "’",
  lsquo: "‘",
  ldquo: "“",
  rdquo: "”",
};

export function unescapeEntities(s: string): string {
  return s
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
    .replace(/&([a-z]+);/gi, (m, n) => NAMED_ENTITIES[n.toLowerCase()] ?? m);
}

export type Rendering = { name: string; text: string; squashed: boolean };

/**
 * Three renderings, because one is never enough:
 *   tags->space  correct for prose, where <p>/<li>/inline <code> break sentences
 *   tags->empty  correct for highlighted code, where a highlighter wraps the colon
 *                in its own span and tags->space yields "exitCode : 137"
 *   squashed     last resort for wrapped or re-indented code
 */
export function renderings(rawHtml: string): Rendering[] {
  const body = rawHtml.replace(/<(script|style|noscript)[^>]*>[\s\S]*?<\/\1>/gi, "");
  const strip = (sep: string) => fold(unescapeEntities(body.replace(/<[^>]+>/g, sep)));

  return [
    { name: "tags->space", text: strip(" ").replace(/\s+/g, " ").trim(), squashed: false },
    { name: "tags->empty", text: strip("").replace(/\s+/g, " ").trim(), squashed: false },
    { name: "whitespace-squashed", text: strip("").replace(/\s+/g, ""), squashed: true },
  ];
}

/** Readable prose extraction, for handing a source to a reader rather than matching it. */
export function toReadableText(rawHtml: string): string {
  const body = rawHtml
    .replace(/<(script|style|noscript|svg)[^>]*>[\s\S]*?<\/\1>/gi, "")
    .replace(/<\/(p|div|li|tr|h[1-6]|pre|section|article|table)>/gi, "\n")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<li[^>]*>/gi, "\n- ");

  return fold(unescapeEntities(body.replace(/<[^>]+>/g, " ")))
    .split("\n")
    .map((line) => line.replace(/[ \t]+/g, " ").trim())
    .filter(Boolean)
    .join("\n");
}

/**
 * Whether `quote` appears on the page. Segments split on an ellipsis must match in
 * order, so an elision cannot stitch together words the source never said in that
 * sequence. Returns the rendering that matched, or null.
 */
export function groundQuote(rawHtml: string, quote: string): string | null {
  const segments = fold(quote)
    .split(/\s*(?:\.\.\.|…)\s*/)
    .map((s) => s.trim())
    .filter(Boolean);

  if (segments.length === 0) return null;

  for (const { name, text, squashed } of renderings(rawHtml)) {
    let cursor = 0;
    let matched = true;

    for (const segment of segments) {
      const needle = squashed ? segment.replace(/\s+/g, "") : segment.replace(/\s+/g, " ");
      const at = text.indexOf(needle, cursor);
      if (at < 0) {
        matched = false;
        break;
      }
      cursor = at + needle.length;
    }

    if (matched) return name;
  }

  return null;
}

/** A citation pointing at a fragment that no longer exists is aimed at the wrong place. */
export function anchorPresent(rawHtml: string, url: string): boolean | null {
  const hash = new URL(url).hash.slice(1);
  if (!hash) return null;
  const decoded = decodeURIComponent(hash);
  const escaped = decoded.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(?:id|name)\\s*=\\s*["']?${escaped}["'\\s>]`, "i").test(rawHtml);
}
