/**
 * A private build has to know the origin it will answer on.
 *
 * Every URL the deployment hands out — the endpoint in the rule, the installer and rule
 * links in the MCP instructions, the canonical on every page — is built from
 * NEXT_PUBLIC_SITE_URL, and its default is the public knowbase.sh. Deploying privately
 * without it produces a store that quietly tells its own agents to send the
 * organisation's error text somewhere else.
 */
if (!process.env.NEXT_PUBLIC_SITE_URL) {
  console.error(
    [
      "",
      "cf:deploy:private needs NEXT_PUBLIC_SITE_URL — the origin this deployment answers on.",
      "Without it the rule, the tool descriptions and every page point at https://knowbase.sh,",
      "which is where your agents would then send their errors.",
      "",
      "  NEXT_PUBLIC_SITE_URL=https://knowbase.example.internal npm run cf:deploy:private",
      "",
    ].join("\n"),
  );
  process.exit(1);
}
