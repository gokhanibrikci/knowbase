import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // Cloudflare adapter output — generated bundles, not ours to lint.
    ".open-next/**",
    // wrangler dev's scratch bundles; they appear the moment a dev session runs.
    ".wrangler/**",
    // Compiled from content/ko/*.yaml on every build.
    "lib/ko/content.generated.ts",
  ]),
]);

export default eslintConfig;
