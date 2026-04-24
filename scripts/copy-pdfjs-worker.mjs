#!/usr/bin/env node
// scripts/copy-pdfjs-worker.mjs
//
// Prebuild step: copy pdfjs-dist's pdf.worker.min.mjs out of
// node_modules into /public/ so it's served as a static asset.
//
// Why we can't just `new URL("pdfjs-dist/.../pdf.worker.mjs",
// import.meta.url)` from client code: webpack/SWC tries to bundle
// the worker file, and SWC can't parse its ES `export` statements in
// non-module context. The build fails with:
//   'import', and 'export' cannot be used outside of module code
// See the failing build log dated 2026-04-24 05:29 on Hostinger.
//
// Instead: ship the worker as /pdfjs-worker.min.mjs and the client
// components set `GlobalWorkerOptions.workerSrc = "/pdfjs-worker.min.mjs"`.
// The browser loads it as a proper Web Worker with correct MIME type.
//
// Runs from `prebuild` (see package.json scripts). Idempotent —
// re-runs just overwrite. Missing source → hard fail so we catch
// the issue at build time rather than at first user click.

import { copyFileSync, mkdirSync, statSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");
const require = createRequire(import.meta.url);

// require.resolve follows the exports map, so this works even if
// pdfjs-dist changes its internal layout in a future major.
const workerSrc = require.resolve("pdfjs-dist/legacy/build/pdf.worker.min.mjs");
const publicDir = resolve(ROOT, "public");
const workerDest = resolve(publicDir, "pdfjs-worker.min.mjs");

mkdirSync(publicDir, { recursive: true });
copyFileSync(workerSrc, workerDest);

const { size } = statSync(workerDest);
console.log(
  `[copy-pdfjs-worker] ${workerSrc.replace(ROOT + "/", "")} → ` +
    `${workerDest.replace(ROOT + "/", "")} (${(size / 1024).toFixed(0)} KB)`
);
