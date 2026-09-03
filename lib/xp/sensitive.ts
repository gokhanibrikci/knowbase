/**
 * The write boundary: what this store will not accept, and what it strips before storing.
 *
 * Everything reported here is published — rendered on /p/<id>, served as JSON and
 * Markdown, listed in the sitemap, submitted to search engines, licensed CC-BY-SA and
 * explicitly opened to model training. There is no un-publishing that, so the only real
 * control sits before the write, not after it.
 *
 * The existing redact() in lib/query-log.ts is a credential scrubber and nothing else:
 * run a card number, an IBAN, a national id, a phone number or an email through it and
 * every one comes back byte-for-byte. That is fine for the class it was written for and
 * useless for the class that gets people fired, so this file handles the second class.
 *
 * Two levers, because the right answer differs by what the value is worth:
 *
 *   refuse       For values that never carry diagnostic information — a card number, a
 *                CVV, track data. Silently scrubbing them would be worse than refusing:
 *                the report would succeed, the person would learn nothing, and they would
 *                do it again tomorrow with something the patterns miss. So the write is
 *                rejected and the reason names what to remove.
 *   placeholder  For values where the SHAPE of the error is the diagnostic content and
 *                the value is incidental. `Key (iban)=(TR33…)` matters as "duplicate key
 *                on uq_merchant_iban"; the IBAN itself adds nothing. Replacing it with
 *                <iban> keeps the record matchable and useful while the value never
 *                enters the store.
 *
 * Neither is a compliance guarantee and this file must not be described as one. Regexes
 * over free text catch shapes, not meaning. It moves the common accident out of reach; a
 * determined paste of a customer record will still get through, which is why the tool
 * descriptions and /rule.md say plainly that what you send is published.
 */

/** Digits only, Luhn-checked — the one test that separates a card number from an id. */
function luhnValid(digits: string): boolean {
  let sum = 0;
  let double = false;
  for (let i = digits.length - 1; i >= 0; i--) {
    let value = digits.charCodeAt(i) - 48;
    if (value < 0 || value > 9) return false;
    if (double) {
      value *= 2;
      if (value > 9) value -= 9;
    }
    sum += value;
    double = !double;
  }
  return sum % 10 === 0;
}

/**
 * Card-number candidates: 13 to 19 digits, allowing the spaces and dashes people paste.
 *
 * Not preceded by a letter or underscore, because `SMOKE1788434079939` is a timestamp
 * glued to a word and not a card — that exact string got a legitimate report refused, and
 * a run of digits inside an identifier is never a pasted card number.
 */
const PAN_CANDIDATE = /(?<![0-9A-Za-z_])(?:[0-9][ -]?){12,18}[0-9](?![0-9])/g;

/**
 * Issuer prefixes, because Luhn on its own is far too weak to accuse anyone with: one in
 * ten random digit runs passes it, so a trace id, an order number or a concatenated
 * timestamp would all be refused as payment cards. A real card carries both — the check
 * digit AND a prefix an issuer was actually assigned.
 */
const CARD_PREFIX =
  /^(?:4|5[1-5]|2(?:22[1-9]|2[3-9][0-9]|[3-6][0-9]{2}|7(?:[01][0-9]|20))|3[47]|3(?:0[0-5]|095|6|[89])|35(?:2[89]|[3-8][0-9])|6(?:011|5|4[4-9]|2)|9792)/;

function panMatches(text: string): string[] {
  const found: string[] = [];
  for (const match of text.matchAll(PAN_CANDIDATE)) {
    const digits = match[0].replace(/[ -]/g, "");
    if (digits.length < 13 || digits.length > 19) continue;
    // A run of one repeated digit is a placeholder in somebody's fixture, not a card.
    if (/^(\d)\1+$/.test(digits)) continue;
    if (!CARD_PREFIX.test(digits)) continue;
    if (luhnValid(digits)) found.push(match[0]);
  }
  return found;
}

/** A verification code, only where something actually labels it as one. */
const CVV_LABELLED = /\b(cvv2?|cvc2?|cid|güvenlik\s*kodu)\b\s*[:=]\s*[0-9]{3,4}\b/gi;

/** Magnetic-stripe track data. Its shape is distinctive and it is never diagnostic. */
const TRACK_DATA = [
  /%B[0-9]{12,19}\^[^^]{2,30}\^[0-9]{4,}/,
  /;[0-9]{12,19}=[0-9]{4,}\?/,
  /\b[0-9]{12,19}=[0-9]{7,}\b/,
];

export type Refusal = { pattern: string; why: string };

/**
 * Why this text must not be stored. Empty means nothing was recognised — which is not
 * the same as safe.
 */
export function refusals(text: string): Refusal[] {
  const out: Refusal[] = [];

  if (panMatches(text).length > 0) {
    out.push({
      pattern: "card number",
      why: "a Luhn-valid 13-19 digit sequence, which is a payment card number. Remove it — the error is just as matchable without it.",
    });
  }
  if (CVV_LABELLED.test(text)) {
    out.push({
      pattern: "card verification code",
      why: "a labelled CVV/CVC. This may not be retained anywhere after authorisation, encrypted or not.",
    });
  }
  if (TRACK_DATA.some((re) => re.test(text))) {
    out.push({
      pattern: "track data",
      why: "magnetic-stripe or chip-equivalent track data. It carries no diagnostic information at all.",
    });
  }
  // Reset lastIndex on the sticky/global patterns so a second call behaves the same.
  CVV_LABELLED.lastIndex = 0;
  return out;
}

/**
 * Values replaced by what they are, keeping the error's shape intact.
 *
 * Order matters: the more specific pattern has to run before a general one can eat part
 * of it, and paths run before hostnames so a URL inside a path is not halved.
 */
const PLACEHOLDERS: Array<[RegExp, string]> = [
  // A Turkish IBAN is TR plus 24 digits; other IBANs are two letters, two check digits
  // and up to 30 alphanumerics. Spaces in groups of four are how they are pasted.
  [/\bTR[ ]?[0-9]{2}(?:[ ]?[0-9]{4}){5}[ ]?[0-9]{2}\b/g, "<iban>"],
  [/\b[A-Z]{2}[0-9]{2}(?:[ ]?[A-Z0-9]{4}){2,7}(?:[ ]?[A-Z0-9]{1,4})?\b/g, "<iban>"],
  // A masked card, which is safe to store but still not worth publishing.
  [/\b[0-9]{6}[*x]{4,8}[0-9]{4}\b/gi, "<masked-card>"],
  // Turkish national id: 11 digits, first is never 0. Deliberately not Luhn-like — the
  // real check needs the full algorithm and a false positive here only costs a
  // placeholder in a record nobody needed the number for.
  [/(?<![0-9])[1-9][0-9]{10}(?![0-9])/g, "<national-id>"],
  [/\b[0-9]{2}\/[0-9]{2,4}\b(?=[^\n]{0,20}\b(?:cvv|cvc|expiry|son\s*kul)\b)/gi, "<expiry>"],
  // Email, then phone. Email first so an address is not partly eaten as a number.
  [/\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g, "<email>"],
  [/\+?90[ -]?\(?5[0-9]{2}\)?[ -]?[0-9]{3}[ -]?[0-9]{2}[ -]?[0-9]{2}\b/g, "<phone>"],
  [/\b0?5[0-9]{2}[ -]?[0-9]{3}[ -]?[0-9]{2}[ -]?[0-9]{2}\b/g, "<phone>"],
  // Absolute paths under a home directory, keeping only the basename: that is the part
  // an agent matches on, and everything above it is the account name and the company's
  // repository layout. Greedy to the last separator — a lazy match kept the username.
  [/\/(?:Users|home)\/[^\s'"()]*\/([^/\s:'"()]+)/g, "<path>/$1"],
  [/\/(?:Users|home)\/[^/\s:'"()]+(?![^\s'"()])/g, "<path>"],
  [/\b[A-Za-z]:\\Users\\[^\s'"()]*\\([^\\\s:'"()]+)/g, "<path>\\$1"],
  // Private network addresses. Loopback stays: "ECONNREFUSED 127.0.0.1:5432" is the error.
  [/\b(?:10\.\d{1,3}\.\d{1,3}\.\d{1,3}|172\.(?:1[6-9]|2\d|3[01])\.\d{1,3}\.\d{1,3}|192\.168\.\d{1,3}\.\d{1,3})\b/g, "<private-ip>"],
  // An AWS account id inside an ARN. The service and resource stay; they are the error.
  [/\b(arn:aws[a-z-]*:[a-z0-9-]*:[a-z0-9-]*:)\d{12}:/g, "$1<account>:"],
  // Internal hostnames. Only the reserved and obviously-private suffixes, so a real
  // public dependency's hostname survives and stays useful. A company's public domain
  // cannot be told from a vendor's, and is not attempted.
  [/\b[A-Za-z0-9][A-Za-z0-9-]*(?:\.[A-Za-z0-9-]+)*\.(?:internal|local|lan|intranet|corp|svc\.cluster\.local|cluster\.local|svc)\b/gi, "<host>"],
];

/**
 * Strip the values that should never have travelled, leaving an error that still reads
 * like the error it was.
 */
export function placehold(text: string): string {
  let out = text;
  for (const [pattern, replacement] of PLACEHOLDERS) {
    out = out.replace(pattern, replacement);
  }
  return out;
}

/** The line a refusal turns into, for a caller that has to act on it. */
export function refusalMessage(found: Refusal[]): string {
  const parts = found.map((f) => `${f.pattern} — ${f.why}`);
  return [
    "This text was not stored, because everything reported here is published: rendered on a public page, served as JSON and Markdown, listed in the sitemap, and licensed for redistribution and model training. There is no way to un-publish it.",
    ...parts.map((p) => `• ${p}`),
    "Remove those values and report again. The error's shape is what makes it matchable; the values are not.",
  ].join("\n");
}
