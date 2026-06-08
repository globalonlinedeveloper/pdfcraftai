#!/usr/bin/env node
/**
 * test-toast-system.mjs (auto-mode batch 2, 2026-06-08): guards the
 * dependency-free toast system (backlog #53/#55).
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
let passed = 0, failed = 0; const fails = [];
const ok = (c, m) => { if (c) passed++; else { failed++; fails.push(m); } };
const read = (r) => fs.readFileSync(path.join(ROOT, r), "utf8");
const exists = (r) => fs.existsSync(path.join(ROOT, r));

// dispatch helper
{
  const rel = "lib/client/toast.ts";
  ok(exists(rel), `${rel} exists`);
  const s = read(rel);
  ok(/export function toast\(/.test(s), "toast(): exported");
  ok(/export const TOAST_EVENT/.test(s), "TOAST_EVENT exported");
  ok(/typeof window === "undefined"/.test(s), "toast(): SSR-safe no-op");
  ok(/try\s*{[\s\S]*dispatchEvent[\s\S]*}\s*catch/.test(s), "toast(): never throws");
}

// renderer
{
  const rel = "components/ui/Toaster.tsx";
  ok(exists(rel), `${rel} exists`);
  const s = read(rel);
  ok(/^"use client";/m.test(s), "Toaster: client component");
  ok(/addEventListener\(TOAST_EVENT/.test(s) && /removeEventListener\(TOAST_EVENT/.test(s), "Toaster: subscribes + cleans up");
  ok(/setTimeout\(/.test(s), "Toaster: auto-dismiss");
  ok(/aria-live/.test(s), "Toaster: aria-live (a11y)");
  ok(/slice\(-4\)/.test(s), "Toaster: caps the stack");
  ok(/items\.length === 0\)\s*return null/.test(s), "Toaster: renders null when idle");
}

// mounted once in the root layout
{
  const s = read("app/layout.tsx");
  ok(/import { Toaster }/.test(s) && /<Toaster \/>/.test(s), "layout: Toaster mounted once");
}

// at least one real consumer (proves it's not dead infra)
{
  const s = read("components/app/files/AiOutputActions.tsx");
  ok(/from "@\/lib\/client\/toast"/.test(s) && /toast\(/.test(s), "AiOutputActions: emits toast on copy/download");
}

console.log("");
if (failed === 0) { console.log(`PASS — ${passed} assertions`); console.log(`${passed} passed, 0 failed`); process.exit(0); }
else { console.error("FAIL:"); fails.forEach(m => console.error("  " + m)); console.log(`${passed} passed, ${failed} failed`); process.exit(1); }
