// scripts/gen-sample-pdf.mjs — generates public/sample.pdf, the file the
// "Try a sample" button on every tool loads so visitors can try a tool
// without hunting for a PDF. Regenerate with: node scripts/gen-sample-pdf.mjs
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import { writeFileSync } from "node:fs";

const doc = await PDFDocument.create();
doc.setTitle("pdfcraft ai — sample document");
doc.setAuthor("pdfcraft ai");
doc.setSubject("A sample PDF for trying the tools");
const font = await doc.embedFont(StandardFonts.Helvetica);
const bold = await doc.embedFont(StandardFonts.HelveticaBold);
const accent = rgb(0.0, 0.4, 1.0);
const ink = rgb(0.1, 0.11, 0.14);
const muted = rgb(0.45, 0.47, 0.52);

const PAGES = [
  {
    h: "Sample Document",
    sub: "A three-page PDF for trying pdfcraft ai's tools.",
    body: [
      "This file exists so you can try any tool without finding a PDF of your own.",
      "It has three pages, headings, paragraphs, a small table, and page numbers —",
      "enough to exercise counting, splitting, rotating, watermarking, text",
      "extraction, and most of the other tools in the catalogue.",
      "",
      "Everything you do here runs in your browser. Files are processed on your",
      "device and are not uploaded to a server.",
    ],
  },
  {
    h: "Section Two",
    sub: "Structure for the tools to work with.",
    body: [
      "Use this page to test splitting out a single page, deleting a page, or",
      "extracting text. The paragraphs below are plain prose so a text export",
      "comes out clean and readable.",
      "",
      "A short table follows, so table-aware tools have something to find:",
    ],
    table: [
      ["Item", "Qty", "Status"],
      ["Invoice", "12", "Filed"],
      ["Receipt", "30", "Pending"],
      ["Contract", "3", "Signed"],
    ],
  },
  {
    h: "Section Three",
    sub: "The last page.",
    body: [
      "This is the final page. Counting tools should report three pages; a split",
      "into single files should produce three; merging this with another file",
      "should append cleanly after page three.",
      "",
      "When you're ready, swap this sample for your own document — the tool works",
      "exactly the same way.",
    ],
  },
];

let n = 0;
for (const spec of PAGES) {
  n += 1;
  const page = doc.addPage([595, 842]); // A4 portrait, points
  const { width, height } = page.getSize();
  let y = height - 70;
  // accent rule
  page.drawRectangle({ x: 56, y: y + 14, width: 40, height: 4, color: accent });
  page.drawText(spec.h, { x: 56, y: y - 18, size: 26, font: bold, color: ink });
  y -= 50;
  page.drawText(spec.sub, { x: 56, y, size: 12, font, color: muted });
  y -= 34;
  for (const line of spec.body) {
    if (line === "") { y -= 10; continue; }
    page.drawText(line, { x: 56, y, size: 12, font, color: ink });
    y -= 18;
  }
  if (spec.table) {
    y -= 12;
    const colX = [56, 320, 430];
    for (let r = 0; r < spec.table.length; r++) {
      const row = spec.table[r];
      const f = r === 0 ? bold : font;
      for (let c = 0; c < row.length; c++) {
        page.drawText(String(row[c]), { x: colX[c], y, size: 12, font: f, color: ink });
      }
      page.drawLine({ start: { x: 56, y: y - 6 }, end: { x: 539, y: y - 6 }, thickness: 0.5, color: rgb(0.85, 0.86, 0.88) });
      y -= 22;
    }
  }
  // footer / page number
  page.drawText("pdfcraft ai · sample document", { x: 56, y: 40, size: 9, font, color: muted });
  page.drawText(`Page ${n} of ${PAGES.length}`, { x: 470, y: 40, size: 9, font, color: muted });
}

const bytes = await doc.save();
writeFileSync(new URL("../public/sample.pdf", import.meta.url), bytes);
console.log(`public/sample.pdf written — ${PAGES.length} pages, ${bytes.length} bytes`);
