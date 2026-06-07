#!/usr/bin/env node
/**
 * test-db-backup-workflow.mjs (#143, 2026-06-07): contract guard for the
 * free, self-hosted DB backup workflow (.github/workflows/db-backup.yml).
 *
 * Static-parse only. Pins the properties that make the backup TRUSTWORTHY
 * and SAFE so a future edit can't quietly turn it into a no-op or a secret
 * leak:
 *
 *   A  Scheduled (cron) + manually dispatchable.
 *   B  Exactly ONE secret — the SSH key — and NO hardcoded DB password.
 *   C  Dump runs server-side (mysqldump | gzip) and is consistency-safe
 *      (--single-transaction).
 *   D  Integrity gates: min-size, gzip -t, and the "Dump completed" marker.
 *   E  Artifact is uploaded with a finite retention and fails if empty.
 *   F  The private key is scrubbed afterwards (always()).
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");

let passed = 0;
let failed = 0;
const failures = [];
function assert(cond, msg) {
  if (cond) passed++;
  else {
    failed++;
    failures.push(msg);
  }
}

const rel = ".github/workflows/db-backup.yml";
assert(fs.existsSync(path.join(ROOT, rel)), `${rel} must exist`);
const wf = fs.readFileSync(path.join(ROOT, rel), "utf8");

// A — triggers
assert(/^on:/m.test(wf), "workflow: has an `on:` trigger block");
assert(/schedule:/.test(wf) && /cron:\s*"[^"]+"/.test(wf), "A: runs on a cron schedule");
assert(/workflow_dispatch:/.test(wf), "A: is manually dispatchable");
assert(/concurrency:/.test(wf), "A: concurrency guard so two dumps never overlap");

// B — exactly one secret, no DB password baked in
const secretRefs = [...wf.matchAll(/secrets\.([A-Z0-9_]+)/g)].map((m) => m[1]);
const uniqSecrets = [...new Set(secretRefs)];
assert(
  uniqSecrets.length === 1 && uniqSecrets[0] === "HOSTINGER_SSH_KEY",
  `B: exactly one secret (HOSTINGER_SSH_KEY); found [${uniqSecrets.join(", ")}]`,
);
// DB creds must be read at runtime from /proc, never hardcoded.
assert(/\/proc\/\$PID\/environ|\/proc\/\$\{?PID/.test(wf), "B: reads DB creds from /proc at runtime");
assert(!/Cognizant@/.test(wf), "B: no hardcoded DB password");
// The DB password must ONLY ever be passed as the shell var -p"$P";
// any other -p<literal> next to a quote would be a hardcoded secret.
const pwFlags = [...wf.matchAll(/-p["'][^"']*["']/g)].map((m) => m[0]);
assert(
  pwFlags.every((f) => f === '-p"$P"'),
  `B: mysqldump password only via -p"$P" (found: ${pwFlags.join(", ") || "none"})`,
);
// The key is written from the secret, not committed.
assert(/secrets\.HOSTINGER_SSH_KEY/.test(wf), "B: SSH key sourced from the secret");

// C — server-side, consistency-safe dump
assert(/mysqldump/.test(wf), "C: uses mysqldump");
assert(/--single-transaction/.test(wf), "C: --single-transaction (consistent snapshot)");
assert(/gzip -c/.test(wf), "C: compresses the dump");
assert(/ssh\b[\s\S]*'bash -s'/.test(wf), "C: dump pipeline executes on the server over ssh");

// D — integrity gates
assert(/-lt 10000/.test(wf), "D: rejects a suspiciously tiny dump");
assert(/gzip -t/.test(wf), "D: verifies gzip integrity");
assert(/Dump completed/.test(wf), "D: checks for mysqldump's completion marker");
assert(/sha256sum/.test(wf), "D: records a sha256 checksum");

// E — artifact retention
assert(/upload-artifact@v4/.test(wf), "E: uploads an artifact");
assert(/retention-days:\s*\d+/.test(wf), "E: sets a finite retention window");
assert(/if-no-files-found:\s*error/.test(wf), "E: fails if no backup file was produced");

// F — key hygiene
assert(/rm -f\s+~\/\.ssh\/id_ed25519/.test(wf), "F: scrubs the private key after use");
assert(/if:\s*always\(\)/.test(wf), "F: scrub runs even on failure (always())");

console.log("");
if (failed === 0) {
  console.log(`PASS — ${passed} assertions`);
  console.log(`${passed} passed, 0 failed`);
  process.exit(0);
} else {
  console.error(`FAIL — ${failed} assertion(s) failed:`);
  for (const m of failures) console.error(`  ${m}`);
  console.log(`${passed} passed, ${failed} failed`);
  process.exit(1);
}
