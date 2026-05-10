#!/usr/bin/env node
/**
 * 2026-05-08 — Item #25 (account deletion polish): DPDP §11 right-
 * of-access UI affordance.
 *
 * The /api/account/export endpoint has been live since the original
 * compliance work but was reachable only by typing the URL by hand —
 * not a meaningful "right." This commit adds an ExportDataButton
 * client component that fetches the endpoint and triggers a
 * download, mounted on /app/settings above the Danger zone (delete-
 * account form) so the reading order matches the DPDP sequence:
 * access first, then optional erasure.
 *
 * What this guard catches:
 *   - ExportDataButton component file deleted/renamed
 *   - Settings page stops importing/mounting it
 *   - Endpoint URL changes without the button updating
 *   - Object URL revoke skipped (M6 invariant — already audited
 *     globally; pinned local shape too)
 *   - DeleteAccountForm copy reverts to the old version that didn't
 *     nudge users toward export first
 *   - Section ordering reverses (Danger zone before Export — wrong
 *     for DPDP semantics: §11 access precedes §12 erasure)
 *
 * Pure static parse. Sub-second.
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

const COMP_PATH = path.join(
  ROOT,
  "components/app/settings/ExportDataButton.tsx",
);
const SETTINGS_PATH = path.join(ROOT, "app/app/settings/page.tsx");
const DELETE_FORM_PATH = path.join(
  ROOT,
  "components/app/settings/DeleteAccountForm.tsx",
);
const ENDPOINT_PATH = path.join(ROOT, "app/api/account/export/route.ts");

for (const p of [COMP_PATH, SETTINGS_PATH, DELETE_FORM_PATH, ENDPOINT_PATH]) {
  assert(fs.existsSync(p), `${path.basename(p)} missing at ${p}`);
}

if (failed > 0) {
  console.log(failures.map((f) => `  ✗ ${f}`).join("\n"));
  console.log(`account-export-ui: ${passed} passed, ${failed} failed`);
  process.exit(1);
}

const COMP = fs.readFileSync(COMP_PATH, "utf8");
const SETTINGS = fs.readFileSync(SETTINGS_PATH, "utf8");
const DELETE_FORM = fs.readFileSync(DELETE_FORM_PATH, "utf8");

// ---------------------------------------------------------------------
// Section A — ExportDataButton component shape.
// ---------------------------------------------------------------------

assert(
  /^"use client"\s*;/m.test(COMP),
  "ExportDataButton must start with `\"use client\";` directive — uses " +
    "useState + fetch + DOM APIs.",
);

assert(
  /export\s+function\s+ExportDataButton\s*\(/.test(COMP),
  "Named export `ExportDataButton` not found.",
);

assert(
  /fetch\(\s*"\/api\/account\/export"/.test(COMP),
  "Component must fetch `/api/account/export` — that's the endpoint " +
    "name pinned by the existing route.ts and the rest of the codebase. " +
    "Renaming it without updating both surfaces silently breaks the flow.",
);

assert(
  /credentials:\s*"same-origin"/.test(COMP),
  "Fetch must include `credentials: \"same-origin\"` so the auth " +
    "cookie is sent. Without this the endpoint returns 401 because " +
    "the session isn't recognized.",
);

// ---------------------------------------------------------------------
// Section B — object URL revoke discipline.
// ---------------------------------------------------------------------

assert(
  /URL\.createObjectURL\(/.test(COMP) && /URL\.revokeObjectURL\(/.test(COMP),
  "Component must call BOTH createObjectURL and revokeObjectURL. " +
    "Forgetting revoke leaks across long-lived tabs (M6 invariant). " +
    "Already audited globally by test-objecturl-revocation.mjs; " +
    "pinned locally here too.",
);

assert(
  /try\s*\{[\s\S]*?\.click\(\);[\s\S]*?\}\s*finally\s*\{[\s\S]*?URL\.revokeObjectURL/.test(
    COMP,
  ),
  "Revoke must run in a `finally` block so a click-handler throw " +
    "doesn't leak the URL.",
);

// ---------------------------------------------------------------------
// Section C — settings page mounts the button.
// ---------------------------------------------------------------------

assert(
  /import\s*\{\s*ExportDataButton\s*\}\s*from\s*"@\/components\/app\/settings\/ExportDataButton"/.test(
    SETTINGS,
  ),
  "Settings page must import ExportDataButton.",
);

assert(
  /<ExportDataButton\s*\/>/.test(SETTINGS),
  "Settings page must mount <ExportDataButton /> in the JSX. Without " +
    "the mount, the button is dead code.",
);

// ---------------------------------------------------------------------
// Section D — section ordering: Export BEFORE Danger zone.
// ---------------------------------------------------------------------
//
// DPDP semantics: §11 right of access precedes §12 right to erasure.
// UI reading order should match — users see "Export your data" first
// and "Danger zone / Delete my account" second. Reversing this could
// nudge users into deletion without offering the access path first.

// Anchor on the H2 elements specifically — the comment block above
// the Export section mentions "Danger zone" as context, which would
// otherwise trip a bare indexOf on that string. The H2s are unambiguous.
const exportIdx = SETTINGS.indexOf(">Export your data<");
const dangerIdx = SETTINGS.indexOf(">Danger zone<");
assert(
  exportIdx > 0 && dangerIdx > 0 && exportIdx < dangerIdx,
  "The 'Export your data' section must appear in the JSX BEFORE " +
    "'Danger zone'. DPDP §11 (access) precedes §12 (erasure); reading " +
    "order should match. Found exportIdx=" + exportIdx +
    ", dangerIdx=" + dangerIdx + ".",
);

// ---------------------------------------------------------------------
// Section E — DeleteAccountForm nudges toward Export first.
// ---------------------------------------------------------------------

assert(
  /Export your data/.test(DELETE_FORM),
  "DeleteAccountForm must mention 'Export your data' so users see the " +
    "nudge inline before committing to delete. Without this, the export " +
    "section above is decoupled from the destructive action below — " +
    "users in a hurry may skip it.",
);

assert(
  /unrecoverable/.test(DELETE_FORM),
  "DeleteAccountForm copy must use the word 'unrecoverable' to be " +
    "explicit about what 'cannot be undone' means. Soft language " +
    "doesn't convey the irreversibility well enough.",
);

// ---------------------------------------------------------------------
// Output
// ---------------------------------------------------------------------

if (failed > 0) {
  console.log(failures.map((f) => `  ✗ ${f}`).join("\n"));
}

console.log(`account-export-ui: ${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
