/**
 * Take the public store's advertising out of a private bundle.
 *
 * Files in public/ are served straight off Cloudflare's asset binding, so unlike a page
 * or a route they cannot decide whether to answer. Several exist only to tell registries,
 * crawlers and search engines about knowbase.sh — its address, its description, its
 * licence, its IndexNow key. A deployment that publishes nothing has no use for any of
 * them, so they are deleted from the built assets before the bundle is uploaded.
 *
 * Runs after `opennextjs-cloudflare build` and before the deploy, in cf:deploy:private.
 */
import fs from "node:fs";
import path from "node:path";

import { PUBLIC_ONLY_ASSETS } from "../lib/gate";

const assets = path.join(".open-next", "assets");
if (!fs.existsSync(assets)) {
  console.error(`private-prune-assets: ${assets} does not exist — run the build first`);
  process.exit(1);
}

const removed: string[] = [];
for (const asset of PUBLIC_ONLY_ASSETS) {
  const target = path.join(assets, asset);
  if (!fs.existsSync(target)) continue;
  fs.rmSync(target, { recursive: true, force: true });
  removed.push(asset);
}

// .well-known holds nothing else today, and an empty directory in the bundle is noise.
const wellKnown = path.join(assets, ".well-known");
if (fs.existsSync(wellKnown) && fs.readdirSync(wellKnown).length === 0) {
  fs.rmdirSync(wellKnown);
}

console.log(
  removed.length > 0
    ? `private-prune-assets: removed ${removed.length} public-only file(s) — ${removed.join(", ")}`
    : "private-prune-assets: nothing to remove",
);
