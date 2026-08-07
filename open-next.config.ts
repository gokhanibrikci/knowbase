import { defineCloudflareConfig } from "@opennextjs/cloudflare";

// Defaults are right for this site: no ISR, no image optimisation, no server
// actions — 33 of 34 routes are prerendered at build time.
export default defineCloudflareConfig();
