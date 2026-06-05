#!/usr/bin/env node
// Shared skeleton-loading contract guard (2026-06-05). Pins the single
// "busy" primitive (components/tools/Skeleton.tsx) + its CSS + the adoption
// in the two shared tool bases, so nobody re-introduces a per-tool spinner /
// pulse card. Static parse — no build needed.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
let passed = 0, failed = 0; const failures = [];
const assert = (c, m) => { if (c) passed++; else { failed++; failures.push(m); console.error(`  ✗ ${m}`); } };
const read = (p) => fs.readFileSync(path.join(ROOT, p), "utf8");

const skel = read("components/tools/Skeleton.tsx");
const css = read("app/globals.css");
const readBase = read("components/tools/PdfReadOpsTool.tsx");
const simpleBase = read("components/tools/PdfSimpleOpsTool.tsx");

console.log("Skeleton.tsx — exports + client directive:");
assert(/^["']use client["'];/m.test(skel), '"use client" directive present');
assert(/export function Skeleton\b/.test(skel), "exports Skeleton()");
assert(/export function ToolBusy\b/.test(skel), "exports ToolBusy()");

console.log("Skeleton.tsx — token-driven (no hard-coded px/colour):");
assert(/var\(--radius-sm\)/.test(skel), "radius via --radius-sm token");
assert(/var\(--space-4\)/.test(skel) && /var\(--space-3\)/.test(skel), "padding/gap via --space tokens");
assert(/var\(--text-sm\)/.test(skel), "label sizing via --text-sm token");
assert(/var\(--fg-muted\)/.test(skel), "label colour via --fg-muted token");
assert(!/#[0-9a-fA-F]{3,8}\b/.test(skel), "no raw hex colours in component");

console.log("Skeleton.tsx — a11y semantics:");
assert(/className="skeleton"/.test(skel), "shimmer uses .skeleton class");
assert(/aria-hidden="true"/.test(skel), "decorative shimmer is aria-hidden");
assert(/role="status"/.test(skel), "ToolBusy is role=status");
assert(/aria-busy="true"/.test(skel), "ToolBusy is aria-busy");
assert(/aria-live="polite"/.test(skel), "ToolBusy announces politely");
// label must be rendered so SR users hear what is happening
assert(/\{label\}/.test(skel), "ToolBusy renders the {label}");

console.log("globals.css — skeleton CSS + keyframes:");
assert(/\.skeleton\s*\{/.test(css), ".skeleton rule defined");
assert(/\.skeleton::after\s*\{/.test(css), ".skeleton::after shimmer defined");
assert(/@keyframes pdfcraft-skeleton\s*\{/.test(css), "@keyframes pdfcraft-skeleton defined");
assert(/animation:\s*pdfcraft-skeleton/.test(css), "::after wired to the keyframes");
assert(/\.skeleton\s*\{[^}]*var\(--bg-2\)/.test(css), "skeleton base colour via --bg-2 token");
assert(/color-mix\(in oklab, var\(--fg\)/.test(css), "shimmer colour via token color-mix (theme-aware)");

console.log("Shared bases adopt ToolBusy (no per-base inline busy card):");
for (const [name, src] of [["PdfReadOpsTool", readBase], ["PdfSimpleOpsTool", simpleBase]]) {
  assert(/import \{ ToolBusy \} from "\.\/Skeleton";/.test(src), `${name} imports ToolBusy`);
  assert(/\{busy && <ToolBusy label=\{props\.busyLabel\} \/>\}/.test(src), `${name} renders <ToolBusy label={props.busyLabel}/>`);
  assert(!/pulse-soft/.test(src), `${name} no longer uses the old pulse-soft busy card`);
}

console.log("");
if (failed === 0) { console.log(`PASS — ${passed} assertions`); console.log(`${passed} passed, 0 failed`); process.exit(0); }
else { console.error("FAIL:"); for (const m of failures) console.error(`  ${m}`); console.log(`${passed} passed, ${failed} failed`); process.exit(1); }
