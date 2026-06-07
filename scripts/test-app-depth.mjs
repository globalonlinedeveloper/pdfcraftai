#!/usr/bin/env node
// App-depth contract guard (2026-06-07, upgrade plan #6): files bulk-delete +
// the Billing/Credits/Receipts shared sub-nav. Static parse.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
let passed = 0, failed = 0; const failures = [];
const assert = (c, m) => { if (c) passed++; else { failed++; failures.push(m); console.error(`  ✗ ${m}`); } };
const read = (p) => fs.readFileSync(path.join(ROOT, p), "utf8");

console.log("files bulk-delete:");
const act = read("lib/files-actions.ts");
assert(/export async function deleteFilesAction\(\s*ids: string\[\]/.test(act), "deleteFilesAction(ids: string[]) exists");
assert(/inArray\(schema\.files\.id, clean\)/.test(act) && /eq\(schema\.files\.userId, userId\)/.test(act), "batch delete scoped by id-set AND userId (ownership enforced)");
assert(/MAX_BULK_DELETE/.test(act) && /\.slice\(0, MAX_BULK_DELETE\)/.test(act), "bulk delete is capped");
assert(/requireUserId\(\)/.test(act), "requires an authenticated user");
const fl = read("components/app/files/FilesList.tsx");
assert(/deleteFilesAction/.test(fl) && /from "@\/lib\/files-actions"/.test(fl), "FilesList imports the batch action");
assert(/selectMode/.test(fl) && /useTransition/.test(fl), "FilesList has a select mode");
assert(/window\.confirm\(/.test(fl), "bulk delete confirms before deleting");
assert(/router\.refresh\(\)/.test(fl), "refreshes after delete");

console.log("Billing/Credits/Receipts shared sub-nav:");
const nav = read("components/app/billing/BillingNav.tsx");
assert(/href: "\/app\/billing"/.test(nav) && /href: "\/app\/credits"/.test(nav) && /href: "\/app\/receipts"/.test(nav), "BillingNav links all three pages");
assert(/aria-current=\{on \? "page" : undefined\}/.test(nav), "active tab marked aria-current=page");
for (const [pg, active] of [["billing","billing"],["credits","credits"],["receipts","receipts"]]) {
  const src = read(`app/app/${pg}/page.tsx`);
  assert(/import \{ BillingNav \}/.test(src), `${pg} imports BillingNav`);
  assert(new RegExp(`<BillingNav active="${active}" />`).test(src), `${pg} renders BillingNav active=${active}`);
}

console.log("");
if (failed === 0) { console.log(`PASS — ${passed} assertions`); console.log(`${passed} passed, 0 failed`); process.exit(0); }
else { console.error("FAIL:"); for (const m of failures) console.error(`  ${m}`); console.log(`${passed} passed, ${failed} failed`); process.exit(1); }
