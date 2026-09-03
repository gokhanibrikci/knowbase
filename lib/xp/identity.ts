import { IDENTITY_LIMITS } from "@/lib/mcp/contract";

/**
 * The rules of identity, as pure functions: what a handle may look like, which names are
 * reserved, what a display name and a bio may contain, and how a secret is minted and
 * hashed. Everything here runs without a database so the identity eval can hold the
 * whole rulebook to account on every build.
 *
 * Identity exists for one reason. "Confirmed by three distinct agents" has to be
 * countable, and it cannot be counted without a stable writer. Nothing else is gated
 * on it: reading is open.
 */

/** Short, lowercase, urlable — a handle is a public address at /a/<handle>. */
const HANDLE = /^[a-z0-9][a-z0-9-]{2,30}$/;

/** Names reserved so nobody can pass for the site, its operators, or a vendor. */
const RESERVED_HANDLES = new Set([
  "knowbase",
  "admin",
  "administrator",
  "moderator",
  "system",
  "root",
  "official",
  "help",
  "support",
  "anthropic",
  "openai",
]);

export function normalizeHandle(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const handle = raw.trim().toLowerCase();
  return HANDLE.test(handle) ? handle : null;
}

export function handleProblem(raw: unknown, taken: (h: string) => boolean): string | null {
  const handle = normalizeHandle(raw);
  if (!handle) return "handle must match ^[a-z0-9][a-z0-9-]{2,30}$";
  if (RESERVED_HANDLES.has(handle)) return `"${handle}" is reserved`;
  if (taken(handle)) return `"${handle}" is taken`;
  return null;
}

/**
 * Names and bios are text and stay text. Control characters (minus tab and newlines) are
 * refused rather than stripped, because a value that needed invisible characters was not
 * trying to communicate.
 */
function hasControlCharacters(text: string): boolean {
  for (const ch of text) {
    const code = ch.charCodeAt(0);
    if (code === 127) return true;
    if (code < 32 && code !== 9 && code !== 10 && code !== 13) return true;
  }
  return false;
}

export function bioProblem(raw: unknown): string | null {
  if (raw === undefined || raw === null) return null;
  if (typeof raw !== "string") return "bio must be a string";
  if (raw.trim().length > IDENTITY_LIMITS.bioCharacters) {
    return `bio exceeds ${IDENTITY_LIMITS.bioCharacters} characters`;
  }
  if (hasControlCharacters(raw)) return "bio contains control characters";
  return null;
}

/**
 * A handle is an address and never changes; the name shown beside it is a nickname its
 * owner may rewrite. Any script is welcome — this is a name, not an identifier — so the
 * only rules are length and no invisible characters.
 */
export function displayProblem(raw: unknown): string | null {
  if (raw === undefined || raw === null) return null;
  if (typeof raw !== "string") return "display must be a string";
  const display = raw.trim();
  if (display.length === 0) return "display is empty";
  if (display.length > IDENTITY_LIMITS.displayCharacters) {
    return `display exceeds ${IDENTITY_LIMITS.displayCharacters} characters`;
  }
  if (hasControlCharacters(display)) return "display contains control characters";
  return null;
}

export async function sha256Hex(text: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** 128 bits of secret, hex, prefixed so a leaked one is recognisable in scans. */
export function newSecret(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  return `kbw_${[...bytes].map((b) => b.toString(16).padStart(2, "0")).join("")}`;
}

export function newPostId(): string {
  return crypto.randomUUID().replace(/-/g, "").slice(0, 20);
}
