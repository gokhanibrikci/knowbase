/**
 * The write boundary, attacked offline.
 *
 * Everything reported here is published, so the redaction pass is the only thing between
 * an agent pasting a traceback and a credential on a public page. An adversarial probe of
 * the first version found that Google API keys, AWS access key ids, Slack tokens, Basic
 * auth headers, passwords in user-less URLs, private addresses, Windows usernames and the
 * account id inside an ARN all came out byte-for-byte. Each of those is pinned here, and
 * so is the other half of the contract: the parts of an error that identify it — a
 * loopback address and port, a package name with its version, a slug — must survive.
 */
import { redact } from "../lib/query-log";
import { placehold, refusals } from "../lib/xp/sensitive";

const RESET = "\x1b[0m";
const RED = "\x1b[31m";
const GREEN = "\x1b[32m";

let failed = 0;
function check(name: string, ok: boolean, detail?: string) {
  if (ok) console.log(`${GREEN}✓${RESET} ${name}`);
  else {
    failed++;
    console.log(`${RED}✖ ${name}${RESET}${detail ? `\n  ${detail}` : ""}`);
  }
}

/** The pass a report goes through before it is stored, in the order the service applies it. */
const publish = (text: string) => placehold(redact(text));

// ---- credentials must not reach publication ---------------------------------------
const secrets: [string, string, string][] = [
  ["GitHub token in a remote URL", "fatal: Authentication failed for 'https://ghp_" + "AbCdNOTAREALSECRETNOTAREALSECRETNOTA@github.com/acme/core.git'", "ghp_AbCd"],
  ["GitHub token bare", "GITHUB_TOKEN ghp_" + "AbCdNOTAREALSECRETNOTAREALSECRETNOTA is invalid", "ghp_AbCd"],
  ["Slack bot token", "SlackApiError: invalid_auth token=xoxb-" + "EXAMPLE-NOT-A-REAL-TOKEN", "xoxb-1234"],
  ["Slack token without a label", "posting with xoxb-" + "EXAMPLE-NOT-A-REAL-TOKEN failed", "xoxb-1234"],
  ["Google API key", "API key not valid. key=AIzaSy" + "D-9tNOTAREALSECRETNOTAREALSECRETN", "AIzaSyD"],
  ["AWS access key id", "InvalidClientTokenId: AccessKeyId AKIA" + "IOSFODNN7EXAMPLE", "AKIA" + "IOSFODNN7EXAMPLE"],
  ["OpenAI project key", "Incorrect API key provided: sk-proj-" + "AbCdNOTAREALSECRETNOTAREALSECRETNOTAREALSECR", "sk-proj-AbCd"],
  ["Anthropic key", "authentication_error: sk-ant-api03-" + "AbCdNOTAREALSECRETNOTAREALSECRETNOTA", "sk-ant-"],
  ["Stripe live key", "STRIPE_SECRET_KEY=sk_live_" + "51H8NOTAREALSECRETNOTAREALSECRETN", "sk_live_51"],
  ["npm token", "//registry.npmjs.org/:_authToken=npm_" + "AbCdNOTAREALSECRETNOTAREALSECRETNOTA", "npm_AbCd"],
  ["knowbase secret", "reported with kbw_" + "01230decaf0decaf0decaf0decaf0dec", "kbw_0123"],
  ["Basic auth header", "> Authorization: Basic Z29raGFuOnN1cGVyc2VjcmV0", "Z29raGFu"],
  ["password in a user-less URL", "REDIS_URL=redis://:redispass@10.0.0.5:6379", "redispass"],
  ["password in a URL", "DATABASE_URL=postgres://ledger_rw:p%40ssw0rd%21@db.example.com:5432/ledger", "p%40ssw0rd"],
  ["token in a query string", "GET https://api.example.com/v1/items?access_token=AbCdEfGh1234567890&page=2 401", "AbCdEfGh1234567890"],
  ["JWT split across lines", "Invalid token eyJ" + "hbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.\neyJ" + "zdWIiOiIxMjM0NTY3ODkwIiwibmFtZSI6IkpvaG4gRG9lIn0.\nSflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c", "eyJhbGci"],
  ["private key block", "-----BEGIN RSA PRIVATE KEY-----\nMIIEowIBAAKCAQEA\n-----END RSA PRIVATE KEY-----", "MIIEowIBAAKCAQEA"],
];
for (const [name, text, marker] of secrets) {
  const out = publish(text);
  check(`redacted: ${name}`, !out.includes(marker), out);
}

// ---- identifying values are replaced by what they are ------------------------------
const placeholders: [string, string, string, string][] = [
  ["private address", "dial tcp 10.0.12.34:6379: connect: connection refused", "10.0.12.34", "<private-ip>"],
  ["AWS account id in an ARN", "User: arn:aws:iam::123456789012:user/dev is not authorized", "123456789012", "<account>"],
  ["kubernetes service host", "getaddrinfo ENOTFOUND redis-prod-a.default.svc.cluster.local", "redis-prod-a", "<host>"],
  ["Windows username in a path", "ENOENT: open 'C:\\Users\\jane.doe\\projects\\shop\\.env'", "jane.doe", "<path>\\.env"],
  ["POSIX username and repo layout", "Can't resolve '@acme/ledger' in '/home/jane/acme-fintech/apps/gateway/src'", "jane", "<path>/src"],
  ["a bare home directory", "cwd: /Users/jane.doe", "jane.doe", "<path>"],
  ["email", "user jane.doe@example.com not found", "jane.doe@example.com", "<email>"],
  ["IBAN", "IBAN TR330006100519786457841326 not found", "TR3300061005", "<iban>"],
  ["national id", "national id 12345678901 already registered", "12345678901", "<national-id>"],
];
for (const [name, text, gone, expected] of placeholders) {
  const out = publish(text);
  check(`placeheld: ${name}`, !out.includes(gone) && out.includes(expected), out);
}

// ---- and what identifies the failure survives ---------------------------------------
const kept: [string, string][] = [
  ["loopback address and port", "Error: connect ECONNREFUSED 127.0.0.1:5432"],
  ["a scoped package with its version", "Cannot find module '@opennextjs/cloudflare@1.20.2'"],
  ["an entry slug", "see /k/kubernetes-init-crashloopbackoff-init-error"],
  ["a stack path outside home", "at Object.<anonymous> (/usr/lib/node_modules/npm/lib/cli.js:12:9)"],
  ["a public vendor hostname", "getaddrinfo ENOTFOUND registry.npmjs.org"],
  ["a container exit code", "container terminated with exit code 137"],
  ["a git sha short enough to be a word", "commit 3f1a2b3 not found"],
  ["prose about rotating a secret", "worked after rotating the secret. Check the token expiry."],
];
for (const [name, text] of kept) {
  check(`kept: ${name}`, publish(text) === text, publish(text));
}

// ---- refusals ----------------------------------------------------------------------
check("a Luhn-valid card number is refused", refusals("card 4242 4242 4242 4242 declined").length > 0);
check("a labelled CVV is refused", refusals("cvv: 123 rejected").length > 0);
check("an ordinary error is not refused", refusals("Error: connect ECONNREFUSED 127.0.0.1:5432").length === 0);
check("a twenty-digit id is not a card", refusals("order 12345678901234567890 failed").length === 0);

console.log(
  failed === 0
    ? `\n${GREEN}redaction: credentials do not reach publication, and the error still reads as the error${RESET}`
    : `\n${RED}${failed} redaction check(s) failed${RESET}`,
);
if (failed > 0) process.exit(1);
