# knowbase

Verified, source-backed answers to concrete engineering failures — published as a
crawlable website and as machine-readable renditions of the same content.

The unit of content is a **Knowledge Object (KO)**: one failure, its root cause, the
fix, the versions it applies to, the primary sources that prove it, and the date those
sources were last read. Entries also declare what they are *not* about, which is what
stops an agent applying a near-miss answer to the wrong problem.

## Running it

```bash
npm run dev
```

| Command             | What it does                                                              |
| ------------------- | ------------------------------------------------------------------------- |
| `npm run dev`       | Dev server on :3000                                                       |
| `npm run build`     | Validates all KOs, then builds. A failing KO fails the build.             |
| `npm run validate`  | Schema, evidence rules and depth floors over `content/ko/*.yaml`          |
| `npm run verify:links` | HTTP-checks every cited source URL. Exits non-zero on dead evidence.   |
| `npm run verify:quotes` | Refetches every source and confirms each quote is still on the page.  |
| `npm run source -- <url>` | Reads a source the way the gate reads it. `--grep`, `--md`.         |
| `npm run crawlers`  | Who fetched the live site in the last 24h, and in which format            |
| `npm run misses`    | Queries `/search.json` could not answer — the authoring queue              |

The two `verify:*` commands are deliberately not part of `build` — the network is not
a build dependency. Run them in CI on a schedule.

`npm run source` shares its fetch and normalisation with `verify:quotes`, so a sentence
copied out of its output is one the gate will find again on the live page. `--md`
prefers a vendor's markdown twin where one exists, which is far cheaper to read:
Stripe's rate-limits page is ~189k tokens as HTML against ~3k as markdown.

## Adding a knowledge object

Create `content/ko/<slug>.yaml`. The filename must match the `slug` field. Then run
`npm run validate`.

The schema lives in [lib/ko/schema.ts](lib/ko/schema.ts) and is enforced, not advisory.
The rules that carry the most weight:

- **Every citation carries a verbatim `quote`, and it is machine-checked.**
  `verify:quotes` refetches the page and fails unless those exact words are still on
  it. This is the difference between "a URL returned 200" and "the source says this".
- **At least one primary source** — `official-docs`, `specification`, or `source-code`.
  Blog posts cannot carry an entry alone. Two sources minimum overall.
- **Every source states what it supports.** The `supports` field says which claim that
  citation backs. A citation that does not is decoration.
- **Confidence is gated by evidence.** `high` needs ≥3 sources with a primary among
  them; `medium` needs ≥2. Claiming more than the sources justify fails the build.
- **Every root cause carries a `discriminator`** — the cheap test telling a reader
  whether this is the cause they have. Causes without one are a search result, not an
  answer. At least one cause must be `primary`.
- **Depth floors, measured not invented** (`checkDepthRules`): ≥4 root causes, ≥5
  solution steps with ≥2 carrying a command or code, ≥2 `notApplicableTo`, ≥2 aliases.
  The seeds average 5.2 causes and 6.2 steps; the floors sit just under that so a
  genuinely thin topic can ship but a lazy entry cannot.
- **Freshness is computed, not asserted.** Each KO sets `reviewIntervalDays`; pages
  report their real age against it and self-label `fresh` / `review-due` / `stale`.

### Drafts

The pipeline writes to `content/ko/.staging/` (git-ignored, invisible to the site
loader) and a draft is promoted into `content/ko/` only once `validate` and
`verify:quotes` both pass. Tooling reads the corpus through `loadAllTolerant()`, which
reports broken files instead of throwing, so a run killed mid-write cannot take down
dev, build and every prerendered route at once. The site itself keeps the strict
loader — a corpus that fails its own rules must not build.

## Routes

| Route                | Content                                                   |
| -------------------- | --------------------------------------------------------- |
| `/`                  | Static index of every entry                               |
| `/k/<slug>`          | The entry, as HTML with TechArticle + FAQPage JSON-LD     |
| `/k/<slug>.json`     | Versioned JSON body (`schemaVersion`), CORS-open          |
| `/k/<slug>.md`       | Markdown                                                  |
| `/k/<slug>.txt`      | Plain text                                                |
| `/d/<domain>`        | Entries in one domain                                     |
| `/search?q=`         | Server-rendered search, `noindex`                         |
| `/search.json?q=`    | Lookup for agents: paste an error, get matching entries   |
| `/llms.txt`          | Index for models, llmstxt.org format                      |
| `/llms-full.txt`     | Whole corpus in one fetch                                 |
| `/about`             | Method: sourcing, evidence rules, confidence definitions  |
| `/sitemap.xml`, `/robots.txt` | Generated; AI crawlers named explicitly          |

The extension forms are rewrites onto `/k/<slug>/<format>` — see
[next.config.ts](next.config.ts). Every page also advertises them via
`<link rel="alternate">`.

### Lookup, and the queue it produces

Everything above is reachable only by knowing a slug or by crawling the index, which
makes the site readable at crawl time but not consultable mid-task. `/search.json?q=`
closes that: it takes an error message, a code, or a whole pasted stack trace, and
returns the entries that cover it.

It answers with a `match` of `strong`, `partial` or `none`, and on `none` the result
list is **empty on purpose**. Returning whatever ranked least badly is how a knowledge
base starts answering the wrong question confidently, and `notApplicableTo` is inlined
on every result for the same reason — ruling an entry out should not cost a second
fetch. Scoring lives in [lib/ko/match.ts](lib/ko/match.ts): terms are weighted by
inverse document frequency, so the boilerplate in a pasted traceback discounts itself,
and the score is scaled by how much of the query's distinctive vocabulary the corpus
knows at all. Without that last part, "terraform state lock could not be acquired"
scores as a confident hit on a MySQL lock-timeout entry.

The queries it *fails* are the reason it exists. Each call writes one row to
Cloudflare Analytics Engine — query, verdict, score, the terms found nowhere in the
corpus — and `npm run misses` ranks them by frequency. That list is the authoring
queue: it is the only evidence of demand that nobody had to guess at.

```bash
npm run misses -- --days 7
```

Note that this log can only decide *what to research*. It never touches a published
`confidence`, which is gated on evidence alone — a second, weaker path to the same
label would make the label mean nothing.

## Architecture

Content is YAML in git, not a database. Version history, diffs, and review come free,
and "who changed this claim and when" stays answerable. The corpus is loaded once per
process and validated at build time, so every page is prerendered static except
`/search`.

```
content/ko/*.yaml       source of truth
lib/ko/schema.ts        zod schema + editorial rules
lib/ko/store.ts         load, validate, freshness
lib/ko/serialize.ts     JSON / Markdown / plain-text renditions
lib/ko/match.ts         error-to-entry matching, and what counts as a miss
lib/ko/jsonld.ts        TechArticle + FAQPage structured data
lib/query-log.ts        one row per lookup, to Analytics Engine
scripts/validate.ts     build gate
scripts/verify-links.ts evidence reachability check
scripts/misses.ts       the authoring queue, read back out of the log
```

## Deploying

Targets Vercel with no configuration. Set `NEXT_PUBLIC_SITE_URL` to the production
origin — it is what canonical URLs, the sitemap, JSON bodies, and `llms.txt` are built
from. Without it everything falls back to `https://knowbase.sh`.

## Licence

Site content is CC-BY-4.0 so that agents and downstream products can reuse it with
attribution. Change it in [lib/site.ts](lib/site.ts), [app/about/page.tsx](app/about/page.tsx),
and the `license` fields in [lib/ko/serialize.ts](lib/ko/serialize.ts) and
[lib/ko/jsonld.ts](lib/ko/jsonld.ts) if that is not what you want.

## Roadmap

Phase 1 (this repo) is the public, crawlable, machine-readable knowledge site. Later
phases — a Knowledge API, MCP/agent-native access, agent success feedback, and automated
re-verification — build on the same schema, which is why the JSON body carries a version.
