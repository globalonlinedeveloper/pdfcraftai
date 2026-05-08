#!/usr/bin/env node
/**
 * 2026-05-08 — Delete AI artifact from preview-page regression guard.
 *
 * Background: AI History sends users into /app/files/[id]/preview;
 * the preview gained Copy/Download/Lateral-nav over the recent
 * commit chain, but had no delete affordance. Users had to bounce
 * back to /app/files to delete. This commit adds a labeled Delete
 * button with two-click confirmation in the preview-page actions
 * row.
 *
 * What this guard catches:
 *   - DeleteAiArtifactButton component file deleted/renamed
 *   - Preview page stops importing/mounting the component
 *   - Component reverts to one-click delete (loses the confirm step
 *     that protects against accidental destructive clicks)
 *   - Auto-disarm timer dropped (a click that arms but never
 *     confirms should reset, otherwise the user's next stray click
 *     deletes)
 *   - Post-delete navigation dropped (preview becomes a 404; staying
 *     on stale data is worse than navigating to AI History)
 *   - deleteFileAction's revalidatePath chain doesn't include
 *     /app/ai-history (the cache there would still show the deleted
 *     artifact for cache-TTL minutes pointing at a 404)
 *   - Component reused DeleteFileButton instead of the
 *     dedicated artifact-delete shape (different UX target — the
 *     /app/files row delete is one-click intentionally)
 *
 * Pure static parse. Sub-second. Output line conforms to the
 * aggregator regex.
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
  "components/app/files/DeleteAiArtifactButton.tsx",
);
const PAGE_PATH = path.join(ROOT, "app/app/files/[id]/preview/page.tsx");
const ACTIONS_PATH = path.join(ROOT, "lib/files-actions.ts");

assert(fs.existsSync(COMP_PATH), `Component missing at ${COMP_PATH}`);
assert(fs.existsSync(PAGE_PATH), `Preview page missing at ${PAGE_PATH}`);
assert(fs.existsSync(ACTIONS_PATH), `files-actions.ts missing at ${ACTIONS_PATH}`);

if (failed > 0) {
  console.log(failures.map((f) => `  ✗ ${f}`).join("\n"));
  console.log(`delete-ai-artifact: ${passed} passed, ${failed} failed`);
  process.exit(1);
}

const COMP_SRC = fs.readFileSync(COMP_PATH, "utf8");
const PAGE_SRC = fs.readFileSync(PAGE_PATH, "utf8");
const ACTIONS_SRC = fs.readFileSync(ACTIONS_PATH, "utf8");

// ---------------------------------------------------------------------
// Section A — component is a client component with the right export.
// ---------------------------------------------------------------------

assert(
  /^"use client"\s*;/m.test(COMP_SRC),
  "Component must start with `\"use client\";` directive — uses " +
    "useState, useEffect, useFormState, useRouter all of which are " +
    "client-only.",
);

assert(
  /export\s+function\s+DeleteAiArtifactButton\s*\(\s*\{\s*id\s*\}/.test(COMP_SRC),
  "Named export `DeleteAiArtifactButton` with `{ id }` prop not found. " +
    "The preview page mounts it with `id={params.id}` so the id prop " +
    "is the contract.",
);

// ---------------------------------------------------------------------
// Section B — two-click confirm pattern.
// ---------------------------------------------------------------------
//
// The preview-page delete is destructive on a focused single
// artifact — different UX from the /app/files row trash icon
// (which is one-click because mid-list re-find-and-undelete is
// hard). The confirm step protects against accidental destructive
// clicks. Without `armed` state the button is one-click, defeating
// the entire purpose of the dedicated component.

assert(
  /useState\s*<?\s*[a-zA-Z]*\s*>?\s*\(\s*false\s*\)/.test(COMP_SRC) &&
    /\barmed\b/.test(COMP_SRC),
  "Two-click confirm requires an `armed` boolean state initialized to " +
    "false. The first click sets it true (showing the confirm copy); " +
    "the second click submits the form. Without this, the component " +
    "is one-click — not the protective shape this surface needs.",
);

assert(
  /Click\s+again\s+to\s+confirm/i.test(COMP_SRC),
  "The armed state must show 'Click again to confirm' copy. Without " +
    "explicit confirm-language users don't know they're past the " +
    "threshold; they might think the first click was the action.",
);

// ---------------------------------------------------------------------
// Section C — auto-disarm timer (so stray later click doesn't fire).
// ---------------------------------------------------------------------

assert(
  /setTimeout\(\s*\(\s*\)\s*=>\s*setArmed\(\s*false\s*\)\s*,\s*\d+\s*\)/.test(
    COMP_SRC,
  ),
  "Armed state must auto-disarm via setTimeout. Without this, a " +
    "click that arms the button but doesn't confirm leaves the " +
    "button in armed state indefinitely — the user's next stray " +
    "click anywhere near this region fires the destructive submit.",
);

assert(
  /clearTimeout\(/.test(COMP_SRC),
  "useEffect cleanup must clearTimeout the disarm timer to prevent " +
    "the timer firing after the component unmounts (the resulting " +
    "setState would be a no-op now but warns + leaks closure refs " +
    "in dev mode).",
);

// ---------------------------------------------------------------------
// Section D — post-delete navigation.
// ---------------------------------------------------------------------

assert(
  /useRouter\(\)/.test(COMP_SRC) &&
    /router\.push\(\s*"\/app\/ai-history"\s*\)/.test(COMP_SRC),
  "After successful delete, must navigate via `router.push(\"/app/ai-history\")`. " +
    "Staying on the now-deleted preview page is a worse UX than " +
    "punting to AI History — the page becomes a 404 on next request.",
);

assert(
  /router\.refresh\(\)/.test(COMP_SRC),
  "After router.push, also call `router.refresh()` to re-fetch the " +
    "AI History server-rendered list with the deleted row absent. " +
    "Without refresh the cached SSR'd AI History page would briefly " +
    "show the deleted artifact.",
);

// ---------------------------------------------------------------------
// Section E — preview page mounts the component with the right id.
// ---------------------------------------------------------------------

assert(
  /import\s*\{\s*DeleteAiArtifactButton\s*\}\s*from\s*"@\/components\/app\/files\/DeleteAiArtifactButton"/.test(
    PAGE_SRC,
  ),
  "Preview page must import DeleteAiArtifactButton.",
);

assert(
  /<DeleteAiArtifactButton[\s\S]*?id=\{params\.id\}/.test(PAGE_SRC),
  "<DeleteAiArtifactButton id={params.id} /> must mount with the URL " +
    "param's id. Anything else (e.g. `id={row.fileId}`) would work " +
    "today but accidentally couples to a different shape if the row " +
    "select changes.",
);

// ---------------------------------------------------------------------
// Section F — deleteFileAction revalidates AI History too.
// ---------------------------------------------------------------------
//
// The action already revalidates /app/files and /app/dashboard
// (legacy callers). Without /app/ai-history added, the Delete
// affordance from preview would leave a stale row in the AI
// History cache for cache-TTL minutes pointing at a 404 preview.

assert(
  /revalidatePath\(\s*"\/app\/ai-history"\s*\)/.test(ACTIONS_SRC),
  "deleteFileAction must `revalidatePath(\"/app/ai-history\")` after " +
    "the DELETE so the AI History cache busts. Without this, the " +
    "deleted artifact stays visible in /app/ai-history pointing at a " +
    "404 preview for cache-TTL minutes.",
);

// ---------------------------------------------------------------------
// Section G — component uses the canonical action (not a clone).
// ---------------------------------------------------------------------
//
// The whole point is reusing the existing deleteFileAction so the
// auth/scoping/cascade behavior stays in one place. A clone would
// drift over time; this guard keeps the import pinned.

assert(
  /import\s*\{\s*deleteFileAction\s*,?\s*type\s+DeleteFileState\s*\}\s*from\s*"@\/lib\/files-actions"/.test(
    COMP_SRC,
  ),
  "Component must import `deleteFileAction` and `DeleteFileState` from " +
    "@/lib/files-actions. Forking the action into a separate function " +
    "would split the auth/scoping/cascade logic across surfaces.",
);

// ---------------------------------------------------------------------
// Output
// ---------------------------------------------------------------------

if (failed > 0) {
  console.log(failures.map((f) => `  ✗ ${f}`).join("\n"));
}

console.log(`delete-ai-artifact: ${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
