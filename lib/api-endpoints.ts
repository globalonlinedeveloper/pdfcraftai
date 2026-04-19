// API endpoints reference data. Ported from prototype content.jsx ApiPage.

export type ApiEndpoint = {
  method: string;
  path: string;
  desc: string;
  price: string;
};

export const API_ENDPOINTS: ApiEndpoint[] = [
  { method: "POST", path: "/v1/merge", desc: "Merge 2+ PDFs", price: "free" },
  { method: "POST", path: "/v1/split", desc: "Split into pages or ranges", price: "free" },
  { method: "POST", path: "/v1/convert", desc: "PDF ↔ Office formats", price: "free" },
  { method: "POST", path: "/v1/ai/chat", desc: "Conversational Q&A with citations", price: "5 credits/Q" },
  { method: "POST", path: "/v1/ai/summarize", desc: "Executive or bullet summary", price: "8 credits" },
  { method: "POST", path: "/v1/ai/translate", desc: "Preserve-layout translation", price: "1 credit/page" },
  { method: "POST", path: "/v1/ai/ocr", desc: "OCR + structured extract", price: "2 credits/page" },
  { method: "POST", path: "/v1/ai/redact", desc: "Auto-detect and redact PII", price: "2 credits/page" },
];

export const API_QUICKSTART = `# Install
npm install @pdfcraftai/sdk

# Summarize a PDF
import { PdfCraft } from '@pdfcraftai/sdk';
const client = new PdfCraft({ apiKey: process.env.PDFCRAFT_API_KEY });

const summary = await client.summarize({
  file: fs.createReadStream('./q3-report.pdf'),
  style: 'executive',
});

console.log(summary.text);
// => "Revenue grew 23% YoY driven by..."
console.log(summary.citations);
// => [{ page: 8, quote: "..." }, { page: 14, quote: "..." }]`;
