#!/usr/bin/env node
/**
 * scripts/test-pdf-tools.mjs
 *
 * Node-based smoke harness for every client-side free tool we ship.
 * Each test exercises the SAME operation the tool performs in the
 * browser — just driven from Node so we can assert pass/fail without
 * a real browser.
 *
 * Run:
 *   node scripts/test-pdf-tools.mjs
 *
 * Returns exit 0 if all pass, 1 if any fail. Intended for hand-run and
 * CI, not for writing fixtures to disk — it uses only in-memory bytes.
 */

import {
  PDFDocument,
  StandardFonts,
  rgb,
  degrees,
} from "pdf-lib";
import * as Cantoo from "@cantoo/pdf-lib";

/* ------------------------------------------------------------------ */
/* Test runner                                                         */
/* ------------------------------------------------------------------ */

let pass = 0;
let fail = 0;
const failures = [];

async function test(name, fn) {
  process.stdout.write(`  • ${name} ... `);
  try {
    await fn();
    pass++;
    console.log("PASS");
  } catch (err) {
    fail++;
    console.log("FAIL");
    console.log(`      ${err && err.stack ? err.stack : err}`);
    failures.push({ name, err });
  }
}

function group(label) {
  console.log(`\n${label}`);
}

function assert(cond, msg) {
  if (!cond) throw new Error(msg || "assertion failed");
}

function assertEq(actual, expected, msg) {
  if (actual !== expected) {
    throw new Error(
      `${msg || "equality"}: expected ${expected}, got ${actual}`,
    );
  }
}

/* ------------------------------------------------------------------ */
/* Fixtures                                                            */
/* ------------------------------------------------------------------ */

/**
 * Make a synthetic PDF of `pageCount` pages with a page label on each.
 * Sized 612×792 (US Letter).
 */
async function makePdf(pageCount) {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  for (let i = 0; i < pageCount; i++) {
    const page = doc.addPage([612, 792]);
    page.drawText(`Page ${i + 1} of ${pageCount}`, {
      x: 72,
      y: 720,
      size: 24,
      font,
      color: rgb(0, 0, 0),
    });
  }
  return doc.save({ useObjectStreams: true });
}

/**
 * Tiny 1×1 red PNG.
 *
 * NOTE: We return a freshly-allocated `Uint8Array` (via `Uint8Array.from`)
 * rather than a Node `Buffer` on purpose. `Buffer.from(base64, 'base64')`
 * returns a Buffer whose underlying `ArrayBuffer` is Node's internal slab
 * allocator — `buf.byteOffset` can be nonzero, meaning the image bytes do
 * NOT start at offset 0 of `buf.buffer`. pdf-lib's `JpegEmbedder.for`
 * (v1.17.1 `cjs/core/embedders/JpegEmbedder.js`) does
 * `new DataView(imageData.buffer); dataView.getUint16(0)` — reading at
 * offset 0 of the underlying slab, not at `byteOffset`. On Node 22 the
 * slab layout happens to place tiny Buffers at offset 0 (so the sandbox
 * passes), but on Node 18/20 in GitHub Actions runners the byteOffset is
 * nonzero and the SOI check reads the wrong two bytes → `Error: SOI not
 * found in JPEG`. `Uint8Array.from(iterable)` iterates and copies into a
 * brand-new ArrayBuffer, so `byteOffset === 0` is guaranteed on every
 * Node version. Production code (`components/tools/ImageToPdfTool.tsx`)
 * already sidesteps this bug because it uses
 * `new Uint8Array(await file.arrayBuffer())`, which gets a fresh
 * byteOffset-0 buffer from the File API — only the base64-decoded test
 * fixtures needed this fix.
 */
function makeRedPng() {
  return Uint8Array.from(
    Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
      "base64",
    ),
  );
}

/**
 * Tiny 2×2 JPEG. See `makeRedPng` for why this returns a Uint8Array
 * rather than a Buffer — same pdf-lib byteOffset issue, more acute for
 * JPEG because `JpegEmbedder.for` reads from offset 0 of the underlying
 * ArrayBuffer without accounting for `imageData.byteOffset`.
 */
function makeBlueJpg() {
  // minimal valid JPEG (1x1 blue-ish) encoded by ChatGPT fixture generator
  return Uint8Array.from(
    Buffer.from(
      "/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/2wBDAQkJCQwLDBgNDRgyIRwhMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjL/wAARCAABAAEDASIAAhEBAxEB/8QAHwAAAQUBAQEBAQEAAAAAAAAAAAECAwQFBgcICQoL/8QAtRAAAgEDAwIEAwUFBAQAAAF9AQIDAAQRBRIhMUEGE1FhByJxFDKBkaEII0KxwRVS0fAkM2JyggkKFhcYGRolJicoKSo0NTY3ODk6Q0RFRkdISUpTVFVWV1hZWmNkZWZnaGlqc3R1dnd4eXqDhIWGh4iJipKTlJWWl5iZmqKjpKWmp6ipqrKztLW2t7i5usLDxMXGx8jJytLT1NXW19jZ2uHi4+Tl5ufo6erx8vP09fb3+Pn6/8QAHwEAAwEBAQEBAQEBAQAAAAAAAAECAwQFBgcICQoL/8QAtREAAgECBAQDBAcFBAQAAQJ3AAECAxEEBSExBhJBUQdhcRMiMoEIFEKRobHBCSMzUvAVYnLRChYkNOEl8RcYGRomJygpKjU2Nzg5OkNERUZHSElKU1RVVldYWVpjZGVmZ2hpanN0dXZ3eHl6goOEhYaHiImKkpOUlZaXmJmaoqOkpaanqKmqsrO0tba3uLm6wsPExcbHyMnK0tPU1dbX2Nna4uPk5ebn6Onq8vP09fb3+Pn6/9oADAMBAAIRAxEAPwD3+iiigD//2Q==",
      "base64",
    ),
  );
}

/* ------------------------------------------------------------------ */
/* Merge tool                                                          */
/* ------------------------------------------------------------------ */

async function testMerge() {
  group("merge");
  await test("merge 3 PDFs (2+3+4 pages)", async () => {
    const a = await makePdf(2);
    const b = await makePdf(3);
    const c = await makePdf(4);
    const out = await PDFDocument.create();
    for (const src of [a, b, c]) {
      const srcDoc = await PDFDocument.load(src);
      const pages = await out.copyPages(srcDoc, srcDoc.getPageIndices());
      pages.forEach((p) => out.addPage(p));
    }
    const bytes = await out.save({ useObjectStreams: true });
    const check = await PDFDocument.load(bytes);
    assertEq(check.getPageCount(), 9, "merged page count");
  });

  await test("merge preserves single PDF unchanged", async () => {
    const a = await makePdf(5);
    const out = await PDFDocument.create();
    const srcDoc = await PDFDocument.load(a);
    const pages = await out.copyPages(srcDoc, srcDoc.getPageIndices());
    pages.forEach((p) => out.addPage(p));
    const bytes = await out.save({ useObjectStreams: true });
    const check = await PDFDocument.load(bytes);
    assertEq(check.getPageCount(), 5, "pass-through page count");
  });
}

/* ------------------------------------------------------------------ */
/* Split tool                                                          */
/* ------------------------------------------------------------------ */

async function testSplit() {
  group("split");
  await test("split 5-page PDF into 5 single-page PDFs", async () => {
    const src = await makePdf(5);
    const srcDoc = await PDFDocument.load(src);
    const outputs = [];
    for (let i = 0; i < srcDoc.getPageCount(); i++) {
      const dest = await PDFDocument.create();
      const [copied] = await dest.copyPages(srcDoc, [i]);
      dest.addPage(copied);
      outputs.push(await dest.save({ useObjectStreams: true }));
    }
    assertEq(outputs.length, 5, "output count");
    for (const bytes of outputs) {
      const check = await PDFDocument.load(bytes);
      assertEq(check.getPageCount(), 1, "split part page count");
    }
  });
}

/* ------------------------------------------------------------------ */
/* Rotate & reorder tool                                               */
/* ------------------------------------------------------------------ */

async function testRotate() {
  group("rotate & reorder");
  await test("rotate every page 90° CW", async () => {
    const src = await makePdf(3);
    const doc = await PDFDocument.load(src);
    for (const page of doc.getPages()) {
      page.setRotation(degrees((page.getRotation().angle + 90) % 360));
    }
    const bytes = await doc.save({ useObjectStreams: true });
    const check = await PDFDocument.load(bytes);
    for (const page of check.getPages()) {
      assertEq(page.getRotation().angle, 90, "page rotation");
    }
  });

  await test("reverse page order (1..5 → 5..1)", async () => {
    const src = await makePdf(5);
    const srcDoc = await PDFDocument.load(src);
    const out = await PDFDocument.create();
    const indices = srcDoc.getPageIndices().slice().reverse();
    const pages = await out.copyPages(srcDoc, indices);
    pages.forEach((p) => out.addPage(p));
    const bytes = await out.save({ useObjectStreams: true });
    const check = await PDFDocument.load(bytes);
    assertEq(check.getPageCount(), 5, "reversed page count");
  });

  await test("delete middle page (3-page → 2-page)", async () => {
    const src = await makePdf(3);
    const srcDoc = await PDFDocument.load(src);
    const out = await PDFDocument.create();
    const pages = await out.copyPages(srcDoc, [0, 2]);
    pages.forEach((p) => out.addPage(p));
    const bytes = await out.save({ useObjectStreams: true });
    const check = await PDFDocument.load(bytes);
    assertEq(check.getPageCount(), 2, "deleted-middle page count");
  });
}

/* ------------------------------------------------------------------ */
/* Compress tool (object-streams re-save)                              */
/* ------------------------------------------------------------------ */

async function testCompress() {
  group("compress");
  await test("re-save with useObjectStreams produces a valid PDF", async () => {
    const src = await makePdf(4);
    const doc = await PDFDocument.load(src);
    const bytes = await doc.save({
      useObjectStreams: true,
      addDefaultPage: false,
    });
    const check = await PDFDocument.load(bytes);
    assertEq(check.getPageCount(), 4, "compressed page count");
    // compressed bytes should be in the same ballpark — assert "valid
    // PDF", not "smaller", since a synthetic fixture may already be
    // near-minimal.
    assert(bytes.byteLength > 0, "compress produced empty output");
  });
}

/* ------------------------------------------------------------------ */
/* Page numbers + watermark                                            */
/* ------------------------------------------------------------------ */

async function testPageNumbers() {
  group("page numbers + watermark");
  await test("stamp Page 1 of N on every page", async () => {
    const src = await makePdf(3);
    const doc = await PDFDocument.load(src);
    const font = await doc.embedFont(StandardFonts.Helvetica);
    const total = doc.getPageCount();
    doc.getPages().forEach((page, i) => {
      const text = `Page ${i + 1} of ${total}`;
      page.drawText(text, {
        x: page.getSize().width / 2 - 40,
        y: 28,
        size: 12,
        font,
      });
    });
    const bytes = await doc.save({ useObjectStreams: true });
    const check = await PDFDocument.load(bytes);
    assertEq(check.getPageCount(), 3, "numbered page count");
  });

  await test("draw diagonal watermark across every page", async () => {
    const src = await makePdf(2);
    const doc = await PDFDocument.load(src);
    const font = await doc.embedFont(StandardFonts.HelveticaBold);
    for (const page of doc.getPages()) {
      const { width, height } = page.getSize();
      page.drawText("DRAFT", {
        x: width / 2 - 120,
        y: height / 2,
        size: 64,
        font,
        color: rgb(0.8, 0.1, 0.1),
        rotate: degrees(45),
        opacity: 0.25,
      });
    }
    const bytes = await doc.save({ useObjectStreams: true });
    const check = await PDFDocument.load(bytes);
    assertEq(check.getPageCount(), 2, "watermarked page count");
  });
}

/* ------------------------------------------------------------------ */
/* Image → PDF                                                          */
/* ------------------------------------------------------------------ */

async function testImageToPdf() {
  group("image → pdf");
  await test("embed a PNG as a single page", async () => {
    const png = makeRedPng();
    const doc = await PDFDocument.create();
    const img = await doc.embedPng(png);
    const page = doc.addPage([img.width || 612, img.height || 792]);
    page.drawImage(img, {
      x: 0,
      y: 0,
      width: page.getSize().width,
      height: page.getSize().height,
    });
    const bytes = await doc.save({ useObjectStreams: true });
    const check = await PDFDocument.load(bytes);
    assertEq(check.getPageCount(), 1, "PNG → 1 page");
  });

  await test("embed a JPG as a single page", async () => {
    const jpg = makeBlueJpg();
    const doc = await PDFDocument.create();
    const img = await doc.embedJpg(jpg);
    const page = doc.addPage([img.width || 612, img.height || 792]);
    page.drawImage(img, {
      x: 0,
      y: 0,
      width: page.getSize().width,
      height: page.getSize().height,
    });
    const bytes = await doc.save({ useObjectStreams: true });
    const check = await PDFDocument.load(bytes);
    assertEq(check.getPageCount(), 1, "JPG → 1 page");
  });

  await test("embed PNG + JPG as two pages in US Letter", async () => {
    const png = makeRedPng();
    const jpg = makeBlueJpg();
    const doc = await PDFDocument.create();
    for (const bytes of [png, jpg]) {
      const looksPng = bytes[0] === 0x89 && bytes[1] === 0x50;
      const img = looksPng
        ? await doc.embedPng(bytes)
        : await doc.embedJpg(bytes);
      const page = doc.addPage([612, 792]);
      page.drawImage(img, { x: 72, y: 72, width: 468, height: 648 });
    }
    const bytes = await doc.save({ useObjectStreams: true });
    const check = await PDFDocument.load(bytes);
    assertEq(check.getPageCount(), 2, "PNG+JPG → 2 pages");
  });
}

/* ------------------------------------------------------------------ */
/* Protect + Unlock (via @cantoo/pdf-lib)                              */
/* ------------------------------------------------------------------ */

async function testProtect() {
  group("protect + unlock");
  const userPw = "test-user-pw-1234";
  const ownerPw = "test-owner-pw-9876";

  let encryptedBytes;

  await test("protect adds password + Encrypt dict on save", async () => {
    const src = await makePdf(2);
    const doc = await Cantoo.PDFDocument.load(src, { ignoreEncryption: true });
    assertEq(doc.isEncrypted, false, "source is not encrypted");
    doc.encrypt({
      userPassword: userPw,
      ownerPassword: ownerPw,
      permissions: {
        printing: "highResolution",
        copying: false,
        modifying: false,
        annotating: true,
        fillingForms: true,
        contentAccessibility: true,
        documentAssembly: false,
      },
    });
    encryptedBytes = await doc.save({ useObjectStreams: true });
    assert(encryptedBytes.byteLength > 0, "encrypted bytes empty");
    // pdf-lib stock should NOT be able to parse this without ignoreEncryption.
    // (We use that to validate the Encrypt dict was written.)
    let rejected = false;
    try {
      await PDFDocument.load(encryptedBytes); // stock pdf-lib
    } catch (_err) {
      rejected = true;
    }
    assert(rejected, "stock pdf-lib loaded an encrypted PDF without complaining");
  });

  await test("load encrypted PDF with wrong password fails", async () => {
    assert(encryptedBytes, "precondition: encryptedBytes set by previous test");
    let threw = false;
    try {
      await Cantoo.PDFDocument.load(encryptedBytes, {
        password: "WRONG-PASSWORD",
      });
    } catch (_err) {
      threw = true;
    }
    assert(threw, "wrong password did not throw");
  });

  await test("load encrypted PDF with correct user password succeeds", async () => {
    const doc = await Cantoo.PDFDocument.load(encryptedBytes, {
      password: userPw,
    });
    assertEq(doc.getPageCount(), 2, "unlocked page count");
  });

  await test("load encrypted PDF with correct owner password succeeds", async () => {
    const doc = await Cantoo.PDFDocument.load(encryptedBytes, {
      password: ownerPw,
    });
    assertEq(doc.getPageCount(), 2, "owner-unlocked page count");
  });

  await test("unlock (re-save without encrypt()) strips encryption", async () => {
    const doc = await Cantoo.PDFDocument.load(encryptedBytes, {
      password: userPw,
    });
    const unlocked = await doc.save({ useObjectStreams: true });
    // stock pdf-lib should now parse it.
    const check = await PDFDocument.load(unlocked);
    assertEq(check.getPageCount(), 2, "unlocked via stock pdf-lib");
  });
}

/* ------------------------------------------------------------------ */
/* Main                                                                */
/* ------------------------------------------------------------------ */

(async () => {
  console.log("== PDF tool smoke tests ==");
  try {
    await testMerge();
    await testSplit();
    await testRotate();
    await testCompress();
    await testPageNumbers();
    await testImageToPdf();
    await testProtect();
  } catch (err) {
    console.error("\nharness crashed:", err);
    process.exit(2);
  }

  console.log(`\n${pass} passed, ${fail} failed.`);
  if (fail > 0) {
    console.log("\nFailures:");
    for (const f of failures) console.log(`  - ${f.name}`);
    process.exit(1);
  }
})();
