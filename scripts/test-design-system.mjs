#!/usr/bin/env node
// Design-token contract guard (2026-06-05). Pins the token layer in
// app/globals.css as the single source for colour / spacing / radius / type /
// width, and verifies BOTH themes drive colour from tokens. Catches a deleted
// token or a light-theme colour that wasn't overridden (which would break the
// toggle). Static parse — no build needed.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
let passed = 0, failed = 0; const failures = [];
const assert = (c, m) => { if (c) passed++; else { failed++; failures.push(m); console.error(`  ✗ ${m}`); } };

const css = fs.readFileSync(path.join(ROOT, "app/globals.css"), "utf8");
// the :root / [data-theme="dark"] base block
const base = (css.match(/:root,\s*\n\s*\[data-theme="dark"\]\s*\{([\s\S]*?)\n\}/) || [])[1] || "";
const light = (css.match(/\[data-theme="light"\]\s*\{([\s\S]*?)\n\}/) || [])[1] || "";
const has = (block, name) => new RegExp("--" + name + "\\s*:").test(block);

assert(base.length > 0, "base token block (:root,[data-theme=dark]) parsed");
assert(light.length > 0, "light theme block parsed");

console.log("colour tokens (base):");
for (const t of ["bg","bg-1","bg-2","bg-3","border","border-strong","fg","fg-muted","fg-subtle","accent","accent-fg","accent-soft","blue","blue-soft","green","green-soft","red","yellow"])
  assert(has(base, t), `--${t} defined`);

console.log("radius / shadow / width:");
for (const t of ["radius","radius-lg","radius-sm","shadow-sm","shadow","shadow-lg","w-narrow","w-standard","w-wide","w-jumbo"])
  assert(has(base, t), `--${t} defined`);

console.log("spacing scale (new):");
for (const t of ["space-1","space-2","space-3","space-4","space-5","space-6","space-8","space-10","space-12","space-16"])
  assert(has(base, t), `--${t} defined`);

console.log("type scale (new):");
for (const t of ["text-xs","text-sm","text-base","text-md","text-lg","text-xl","text-2xl","text-3xl","text-4xl"])
  assert(has(base, t), `--${t} defined`);

console.log("light theme overrides core colours (both themes token-driven):");
for (const t of ["bg","bg-1","border","fg","fg-muted","fg-subtle","accent","accent-fg","accent-soft","blue","blue-soft","green"])
  assert(has(light, t), `light overrides --${t}`);
// spacing/type are theme-agnostic — must NOT be redefined per-theme
assert(!has(light, "space-4") && !has(light, "text-base"), "spacing/type are theme-agnostic (not redefined in light)");

console.log("");
if (failed === 0) { console.log(`PASS — ${passed} assertions`); console.log(`${passed} passed, 0 failed`); process.exit(0); }
else { console.error("FAIL:"); for (const m of failures) console.error(`  ${m}`); console.log(`${passed} passed, ${failed} failed`); process.exit(1); }
