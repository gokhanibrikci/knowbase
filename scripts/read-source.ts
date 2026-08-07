/**
 * Fetch a source document and print it as readable text.
 *
 * This is the research half of the grounding gate: it uses the same fetch and
 * normalisation as verify-quotes, so a sentence copied out of this output is a
 * sentence the gate will find again on the live page.
 *
 *   npm run source -- <url>                 whole document
 *   npm run source -- <url> --grep <regex>  matching lines with context
 *   npm run source -- <url> --md            prefer the vendor markdown twin
 */
import { fetchPage, markdownTwin, toReadableText } from "../lib/ko/text";

const DIM = "\x1b[2m";
const YELLOW = "\x1b[33m";
const RESET = "\x1b[0m";

async function main() {
  const args = process.argv.slice(2);
  const url = args.find((a) => !a.startsWith("--"));
  if (!url) {
    console.error("usage: npm run source -- <url> [--grep <regex>] [--md] [--context N]");
    process.exit(2);
  }

  const grepAt = args.indexOf("--grep");
  const pattern = grepAt >= 0 ? args[grepAt + 1] : undefined;
  const ctxAt = args.indexOf("--context");
  const context = ctxAt >= 0 ? Number(args[ctxAt + 1]) : 1;

  let target = url;
  if (args.includes("--md")) {
    const twin = markdownTwin(url);
    if (twin) {
      const head = await fetchPage(twin).catch(() => null);
      // A vendor that does not publish a twin usually answers with its HTML shell.
      if (head && !/^\s*</.test(head)) {
        target = twin;
        console.error(`${DIM}using markdown twin: ${twin}${RESET}`);
      } else {
        console.error(`${DIM}no usable markdown twin, falling back to HTML${RESET}`);
      }
    }
  }

  const raw = await fetchPage(target);
  const isMarkdown = target.endsWith(".md") || !/^\s*</.test(raw);
  const text = isMarkdown ? raw : toReadableText(raw);
  const lines = text.split("\n");

  console.error(`${DIM}${lines.length} lines · ${text.length} chars · ${target}${RESET}\n`);

  if (!pattern) {
    console.log(text);
    return;
  }

  const re = new RegExp(pattern, "i");
  const hits = lines.flatMap((line, i) => (re.test(line) ? [i] : []));

  if (hits.length === 0) {
    console.error(`${YELLOW}no line matches /${pattern}/i${RESET}`);
    process.exit(1);
  }

  const shown = new Set<number>();
  for (const hit of hits) {
    for (let i = Math.max(0, hit - context); i <= Math.min(lines.length - 1, hit + context); i++) {
      shown.add(i);
    }
  }

  let previous = -2;
  for (const i of [...shown].sort((a, b) => a - b)) {
    if (i !== previous + 1) console.log(`${DIM}---${RESET}`);
    console.log(`${DIM}${String(i + 1).padStart(5)}${RESET}  ${lines[i]}`);
    previous = i;
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
