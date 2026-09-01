/**
 * The experience store's rulebook, attacked offline.
 *
 * Fingerprinting is the whole product: two agents who never met must recognise the same
 * failure, and must NOT be told about a different one. Both mistakes are silent — an
 * under-merge makes the store look empty, an over-merge hands out the wrong answer — so
 * both are pinned here with real error text, not synthetic strings.
 *
 * Several of these cases exist because an adversarial review ran the code and found the
 * bug: every Python traceback fingerprinted as "Traceback (most recent call last)", and
 * exit code 137 and 143 collided because the normalizer flattened every number.
 */
import { XP_LIMITS } from "../lib/mcp/contract";
import {
  environmentMatch,
  errorHeadline,
  fingerprint,
  insufficientSignal,
  parseEnvironment,
  signatureTokens,
  titleFrom,
} from "../lib/xp/fingerprint";
import { type Report, rank, summarize } from "../lib/xp/standing";

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

const PY_MISSING_MODULE = `Traceback (most recent call last):
  File "/Users/someone/app/main.py", line 3, in <module>
    import yaml
ModuleNotFoundError: No module named 'yaml'`;

const PY_MISSING_MODULE_ELSEWHERE = `Traceback (most recent call last):
  File "/srv/deploy/run.py", line 41, in handler
    import yaml
ModuleNotFoundError: No module named 'yaml'`;

const PY_OTHER = `Traceback (most recent call last):
  File "/srv/deploy/run.py", line 9, in run
    conn.execute(sql)
psycopg2.OperationalError: FATAL: sorry, too many clients already`;

const NPM_ERESOLVE = `npm error code ERESOLVE
npm error ERESOLVE unable to resolve dependency tree
npm error Found: react@18.2.0`;

const NPM_PEER_OTHER = `npm error code ETARGET
npm error notarget No matching version found for vite@^99.0.0`;

async function main() {
  // ---- the failure must survive the machine it happened on --------------------
  const a = await fingerprint(PY_MISSING_MODULE);
  const b = await fingerprint(PY_MISSING_MODULE_ELSEWHERE);
  check(
    "same failure on two different machines fingerprints identically",
    a === b,
    `${a} vs ${b}`,
  );

  const other = await fingerprint(PY_OTHER);
  check(
    "two different Python errors do NOT collide (the traceback header is not the error)",
    a !== other,
    `both hashed to ${a}`,
  );
  check(
    "the Python error line is the headline, not 'Traceback (most recent call last)'",
    /ModuleNotFoundError/i.test(errorHeadline(PY_MISSING_MODULE)),
    errorHeadline(PY_MISSING_MODULE),
  );

  // ---- numbers that ARE the error must survive --------------------------------
  const oom = await fingerprint("container terminated with exit code 137");
  const term = await fingerprint("container terminated with exit code 143");
  check("exit code 137 and 143 are different failures", oom !== term, `both ${oom}`);

  const e413 = await fingerprint("nginx: 413 Request Entity Too Large");
  const e502 = await fingerprint("nginx: 502 Bad Gateway");
  check("HTTP 413 and 502 are different failures", e413 !== e502);

  // ---- but the noise around it must not ---------------------------------------
  const line1 = await fingerprint("TypeError: x is not a function\n    at /app/src/a.js:12:9");
  const line2 = await fingerprint("TypeError: x is not a function\n    at /srv/b/src/a.js:481:3");
  check("line numbers and paths do not split one failure in two", line1 === line2);

  const withId = await fingerprint(
    "Request 4f9a1c2e-1111-4bbb-8ccc-0123456789ab failed: upstream connect error",
  );
  const withOtherId = await fingerprint(
    "Request 8e2b7d40-2222-4aaa-9ddd-fedcba987654 failed: upstream connect error",
  );
  check("per-run identifiers do not split one failure in two", withId === withOtherId);

  // ---- prefixed blocks (npm, cargo, esbuild) ----------------------------------
  const eresolve = await fingerprint(NPM_ERESOLVE);
  const etarget = await fingerprint(NPM_PEER_OTHER);
  check(
    "npm's prefixed block keeps its meaning: ERESOLVE and ETARGET are different",
    eresolve !== etarget,
    `both ${eresolve}`,
  );
  check(
    "the npm headline carries the actual code, not just the prefix",
    /eresolve/i.test(errorHeadline(NPM_ERESOLVE)),
    errorHeadline(NPM_ERESOLVE),
  );

  // ---- carrier lines may never become a mega-problem --------------------------
  for (const carrier of [
    "Build failed with exit code 1",
    "Command failed",
    "error: process completed with exit code 1",
    "make: *** [build] Error 2",
  ]) {
    check(`carrier line refused: "${carrier}"`, insufficientSignal(carrier) !== null);
  }
  check(
    "a carrier line ABOVE a real error does not win",
    /econnrefused/i.test(
      errorHeadline("Build failed with exit code 1\nError: connect ECONNREFUSED 127.0.0.1:5432"),
    ),
    errorHeadline("Build failed with exit code 1\nError: connect ECONNREFUSED 127.0.0.1:5432"),
  );
  check(
    "a real failure is not refused",
    insufficientSignal(PY_MISSING_MODULE) === null &&
      insufficientSignal("container terminated with exit code 137 and reason OOMKilled") === null,
  );

  // ---- titles ------------------------------------------------------------------
  check(
    "title names the failure, not the traceback header",
    titleFrom(PY_MISSING_MODULE).includes("ModuleNotFoundError"),
    titleFrom(PY_MISSING_MODULE),
  );

  // ---- environments -------------------------------------------------------------
  const mine = parseEnvironment(["Next@16.3.0", "@opennextjs/cloudflare@1.20.2", "node@22"]);
  check(
    "scoped package names keep their scope and split on the last @",
    mine.some((e) => e.name === "@opennextjs/cloudflare" && e.version === "1.20.2"),
    JSON.stringify(mine),
  );
  check(
    "environment match: exact version is 'same'",
    environmentMatch(mine, parseEnvironment(["next@16.3.0"])) === "same",
  );
  check(
    "environment match: same major is 'compatible'",
    environmentMatch(mine, parseEnvironment(["next@16.9.1"])) === "compatible",
  );
  check(
    "environment match: a different major is 'different'",
    environmentMatch(mine, parseEnvironment(["next@15.0.0"])) === "different",
  );
  check(
    "environment match: nothing in common is 'unknown'",
    environmentMatch(mine, parseEnvironment(["django@5.0"])) === "unknown",
  );
  check("environment match: silence is 'unknown'", environmentMatch(mine, []) === "unknown");

  // ---- standing: what the store may honestly claim -------------------------------
  const env = parseEnvironment(["next@16.3.0"]);
  const author = "alpha";
  const selfOnly: Report[] = [
    { agentId: author, netHash: "net-author", provisional: false, worked: true, env, prompted: false, at: 1 },
  ];
  const s1 = summarize(selfOnly, author, env);
  check(
    "an author vouching for its own fix is not corroboration",
    s1.independent === 0 && /Nobody else has tried it/i.test(s1.claim),
    s1.claim,
  );
  check(
    "but an uncorroborated fix is still an answer, not a dead end",
    s1.reproduced === 1,
    JSON.stringify(s1),
  );
  check(
    "a solution nobody got to work is the dead end",
    summarize([{ agentId: "beta", netHash: "net-beta", provisional: false, worked: false, env, prompted: false, at: 2 }], author, env)
      .reproduced === 0,
  );

  const withOthers: Report[] = [
    ...selfOnly,
    { agentId: "beta", netHash: "net-beta", provisional: false, worked: true, env, prompted: false, at: 2 },
    { agentId: "gamma", netHash: "net-gamma", provisional: false, worked: true, env, prompted: true, at: 3 },
  ];
  const s2 = summarize(withOthers, author, env);
  check(
    "prompted confirmations are counted apart from independent ones",
    s2.independent === 1 && s2.prompted === 1,
    JSON.stringify(s2),
  );
  check(
    "the claim never merges the two into one number",
    /1 agent hit this independently/.test(s2.claim) && /plus 1 who confirmed/.test(s2.claim),
    s2.claim,
  );

  const repeated: Report[] = [
    { agentId: "beta", netHash: "net-beta", provisional: false, worked: true, env, prompted: false, at: 2 },
    { agentId: "beta", netHash: "net-beta", provisional: false, worked: true, env, prompted: false, at: 9 },
  ];
  check(
    "one agent reporting twice counts once",
    summarize(repeated, author, env).independent === 1,
  );

  const contested: Report[] = [
    ...withOthers,
    { agentId: "delta", netHash: "net-delta", provisional: false, worked: false, env: parseEnvironment(["next@15.1.0"]), prompted: true, at: 4 },
  ];
  const s3 = summarize(contested, author, env);
  check("failures are surfaced in the claim, never hidden", s3.failed === 1 && /did NOT work/.test(s3.claim), s3.claim);

  const deadEnd = summarize(
    [{ agentId: "beta", netHash: "net-beta", provisional: false, worked: false, env, prompted: false, at: 2 }],
    author,
    env,
  );
  check("an all-failed solution reads as a dead end", /dead end/i.test(deadEnd.claim), deadEnd.claim);

  // ---- five handles behind one egress are one voice --------------------------
  const sybils: Report[] = Array.from({ length: 5 }, (_, i) => ({
    agentId: `sock-${i}`,
    netHash: "net-one-basement",
    provisional: false,
    worked: true,
    env,
    prompted: true,
    at: 10 + i,
  }));
  const farmed = summarize(sybils, author, env);
  check(
    "a confirmation farm is counted, but its single network is published beside the count",
    farmed.prompted === 5 && farmed.distinctNetworks === 1,
    JSON.stringify(farmed),
  );
  check(
    "and the claim says so in words, where a reader will actually see it",
    /single network/i.test(farmed.claim),
    farmed.claim,
  );
  const honest = summarize(
    sybils.map((r, i) => ({ ...r, netHash: `net-${i}` })),
    author,
    env,
  );
  check(
    "five agents on five networks are five voices",
    honest.distinctNetworks === 5,
  );
  check(
    "an hour-old agent's confirmation counts — the gate is age, not square activity",
    summarize(
      [{ agentId: "settled", netHash: "net-s", provisional: false, worked: true, env, prompted: true, at: 3 }],
      author,
      env,
    ).prompted === 1,
  );
  check(
    "a brand-new arrival is shown but does not yet count",
    summarize(
      [{ agentId: "fresh", netHash: "net-x", provisional: true, worked: true, env, prompted: false, at: 3 }],
      author,
      env,
    ).independent === 0,
  );

  check(
    "ranking puts anything that worked above a dead end",
    rank(s2, deadEnd) < 0 && rank(deadEnd, s2) > 0,
  );
  check(
    "ranking prefers the environment that matches yours",
    rank(
      summarize([{ agentId: "b", netHash: "net-b", provisional: false, worked: true, env, prompted: false, at: 1 }], author, env),
      summarize(
        [
          {
            agentId: "c",
            netHash: "net-c",
            provisional: false,
            worked: true,
            env: parseEnvironment(["django@5.0"]),
            prompted: false,
            at: 1,
          },
        ],
        author,
        env,
      ),
    ) < 0,
  );

  // ---- limits stay sane ----------------------------------------------------------
  check(
    "a recall answer stays cheap to read",
    XP_LIMITS.solutionCharacters <= 2_000 && XP_LIMITS.sampleCharacters <= 2_000,
  );
  check(
    "signature tokens are bounded",
    signatureTokens(PY_MISSING_MODULE).length > 1 && signatureTokens(PY_MISSING_MODULE).length <= 12,
  );

  console.log(
    failed === 0
      ? `\n${GREEN}experience: fingerprints hold, environments compare honestly, standing never overstates${RESET}`
      : `\n${RED}${failed} experience check(s) failed${RESET}`,
  );
  if (failed > 0) process.exit(1);
}

main();
