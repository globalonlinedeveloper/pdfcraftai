"use client";

// InvoiceGeneratorTool — Tier 3 §3.1 Finance / §3.7 Small Business.
//
// Generate a professional one-page tax invoice PDF from a simple
// form. Targeted at Indian freelancers and small business owners
// who need GST-compliant invoices but don't want to spin up
// Tally / Zoho / QuickBooks for a single bill.
//
// Pure pdf-lib — no external template engine, no server round-trip.
// Line items → sub-total → optional GST (18% CGST+SGST split OR
// 18% IGST for inter-state) → grand total. Rupees (₹) by default,
// currency symbol configurable.
//
// Why Tier 3 not Tier 1: this is a "generate from scratch" tool,
// not a "manipulate an existing PDF" one. The catalog puts it in
// §3.1 Finance / §3.7 Small Business — both Indian-market high-
// ARPU wedges. Ships free as a demand-gen hook: someone searching
// "gst invoice pdf generator" lands here, uses it, sees our 20+
// other free tools in the footer.

import { useState, useCallback } from "react";
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import { I } from "@/components/icons/Icons";
import {
  downloadBytes,
  humanSize,
  sha256HexOfBytes,
} from "@/lib/client/pdf-utils";
import { logToolResultAction } from "@/lib/tool-result-actions";

type LineItem = {
  id: string;
  description: string;
  quantity: number;
  unitPrice: number;
};

type Form = {
  invoiceNumber: string;
  invoiceDate: string; // ISO yyyy-mm-dd
  dueDate: string;
  fromName: string;
  fromAddress: string;
  fromGstin: string;
  toName: string;
  toAddress: string;
  toGstin: string;
  currency: "INR" | "USD" | "EUR" | "GBP";
  taxMode: "none" | "cgst-sgst" | "igst";
  taxRatePct: number;
  notes: string;
};

const CURRENCY_LABEL: Record<Form["currency"], string> = {
  INR: "₹",
  USD: "$",
  EUR: "€",
  GBP: "£",
};

const defaultForm = (): Form => ({
  invoiceNumber: `INV-${new Date().getFullYear()}-001`,
  invoiceDate: new Date().toISOString().slice(0, 10),
  dueDate: "",
  fromName: "",
  fromAddress: "",
  fromGstin: "",
  toName: "",
  toAddress: "",
  toGstin: "",
  currency: "INR",
  taxMode: "cgst-sgst",
  taxRatePct: 18,
  notes: "",
});

const newItem = (): LineItem => ({
  id: Math.random().toString(36).slice(2, 10),
  description: "",
  quantity: 1,
  unitPrice: 0,
});

export function InvoiceGeneratorTool() {
  const [form, setForm] = useState<Form>(defaultForm);
  const [items, setItems] = useState<LineItem[]>([newItem()]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{ bytes: Uint8Array; name: string; size: number } | null>(null);

  const update = useCallback(<K extends keyof Form>(k: K, v: Form[K]) => {
    setForm((f) => ({ ...f, [k]: v }));
  }, []);

  const updateItem = (id: string, patch: Partial<LineItem>) => {
    setItems((prev) => prev.map((it) => (it.id === id ? { ...it, ...patch } : it)));
  };

  const addItem = () => setItems((prev) => [...prev, newItem()]);
  const removeItem = (id: string) =>
    setItems((prev) => (prev.length <= 1 ? prev : prev.filter((it) => it.id !== id)));

  const subtotal = items.reduce((s, it) => s + it.quantity * it.unitPrice, 0);
  const tax = form.taxMode === "none" ? 0 : (subtotal * form.taxRatePct) / 100;
  const total = subtotal + tax;

  const fmt = (n: number) =>
    `${CURRENCY_LABEL[form.currency]}${n.toLocaleString("en-IN", {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    })}`;

  const generate = async () => {
    setBusy(true);
    setError(null);
    setResult(null);
    try {
      if (!form.fromName.trim() || !form.toName.trim()) {
        throw new Error("From and Bill To names are required.");
      }
      if (items.every((it) => !it.description.trim())) {
        throw new Error("Add at least one line item with a description.");
      }

      const doc = await PDFDocument.create();
      const page = doc.addPage([595, 842]); // A4
      const helv = await doc.embedFont(StandardFonts.Helvetica);
      const helvBold = await doc.embedFont(StandardFonts.HelveticaBold);

      const black = rgb(0.05, 0.05, 0.05);
      const grey = rgb(0.45, 0.45, 0.45);
      const accent = rgb(0.09, 0.47, 0.95);
      const border = rgb(0.85, 0.85, 0.85);

      let y = 800;

      // Header band.
      page.drawText("INVOICE", { x: 40, y, size: 28, font: helvBold, color: accent });
      page.drawText(form.invoiceNumber, { x: 400, y: y + 8, size: 11, font: helvBold, color: black });
      page.drawText(`Date: ${form.invoiceDate}`, { x: 400, y: y - 8, size: 10, font: helv, color: grey });
      if (form.dueDate) {
        page.drawText(`Due: ${form.dueDate}`, { x: 400, y: y - 22, size: 10, font: helv, color: grey });
      }
      y -= 60;
      page.drawLine({ start: { x: 40, y }, end: { x: 555, y }, color: border, thickness: 1 });
      y -= 20;

      // From / To.
      const drawParty = (label: string, name: string, addr: string, gstin: string, x: number) => {
        let yy = y;
        page.drawText(label, { x, y: yy, size: 10, font: helvBold, color: grey });
        yy -= 14;
        page.drawText(name, { x, y: yy, size: 12, font: helvBold, color: black });
        yy -= 14;
        for (const line of addr.split("\n").slice(0, 4)) {
          page.drawText(line, { x, y: yy, size: 10, font: helv, color: black });
          yy -= 12;
        }
        if (gstin.trim()) {
          yy -= 4;
          page.drawText(`GSTIN: ${gstin}`, { x, y: yy, size: 10, font: helv, color: grey });
        }
      };
      drawParty("FROM", form.fromName, form.fromAddress, form.fromGstin, 40);
      drawParty("BILL TO", form.toName, form.toAddress, form.toGstin, 300);
      y -= 110;

      // Line-items table.
      const col = { desc: 40, qty: 340, price: 400, amount: 480 };
      page.drawRectangle({ x: 40, y: y - 4, width: 515, height: 20, color: rgb(0.95, 0.95, 0.97) });
      page.drawText("DESCRIPTION", { x: col.desc + 4, y: y, size: 9, font: helvBold, color: black });
      page.drawText("QTY", { x: col.qty + 4, y: y, size: 9, font: helvBold, color: black });
      page.drawText("UNIT PRICE", { x: col.price + 4, y: y, size: 9, font: helvBold, color: black });
      page.drawText("AMOUNT", { x: col.amount + 4, y: y, size: 9, font: helvBold, color: black });
      y -= 24;

      for (const it of items) {
        if (!it.description.trim()) continue;
        page.drawText(it.description.slice(0, 60), { x: col.desc + 4, y, size: 10, font: helv, color: black });
        page.drawText(String(it.quantity), { x: col.qty + 4, y, size: 10, font: helv, color: black });
        page.drawText(fmt(it.unitPrice).replace(CURRENCY_LABEL[form.currency], ""), {
          x: col.price + 4,
          y,
          size: 10,
          font: helv,
          color: black,
        });
        page.drawText(fmt(it.quantity * it.unitPrice), {
          x: col.amount + 4,
          y,
          size: 10,
          font: helv,
          color: black,
        });
        y -= 16;
        page.drawLine({ start: { x: 40, y: y + 8 }, end: { x: 555, y: y + 8 }, color: border, thickness: 0.5 });
      }

      y -= 10;

      // Totals box.
      const drawTotal = (label: string, value: string, bold = false) => {
        const fontSel = bold ? helvBold : helv;
        const size = bold ? 12 : 10;
        page.drawText(label, { x: 380, y, size, font: fontSel, color: bold ? black : grey });
        page.drawText(value, { x: 480, y, size, font: fontSel, color: black });
        y -= 16;
      };
      drawTotal("Subtotal", fmt(subtotal));
      if (form.taxMode === "cgst-sgst") {
        drawTotal(`CGST @ ${form.taxRatePct / 2}%`, fmt(tax / 2));
        drawTotal(`SGST @ ${form.taxRatePct / 2}%`, fmt(tax / 2));
      } else if (form.taxMode === "igst") {
        drawTotal(`IGST @ ${form.taxRatePct}%`, fmt(tax));
      }
      y -= 4;
      page.drawLine({ start: { x: 370, y: y + 8 }, end: { x: 555, y: y + 8 }, color: black, thickness: 1 });
      drawTotal("TOTAL", fmt(total), true);
      y -= 10;

      if (form.notes.trim()) {
        page.drawText("NOTES", { x: 40, y, size: 9, font: helvBold, color: grey });
        y -= 14;
        for (const line of form.notes.split("\n").slice(0, 6)) {
          page.drawText(line.slice(0, 80), { x: 40, y, size: 10, font: helv, color: black });
          y -= 12;
        }
      }

      // Footer.
      page.drawText("Generated with pdfcraft ai · pdfcraftai.com", {
        x: 40,
        y: 30,
        size: 8,
        font: helv,
        color: grey,
      });

      const bytes = await doc.save({ useObjectStreams: true });
      const name = `${form.invoiceNumber || "invoice"}.pdf`;
      setResult({ bytes, name, size: bytes.length });

      try {
        const sha256 = await sha256HexOfBytes(bytes);
        await logToolResultAction({
          toolId: "invoice-generator",
          name,
          mime: "application/pdf",
          sizeBytes: bytes.length,
          sha256,
        });
      } catch (logErr) {
        console.warn("logToolResult failed (non-fatal):", logErr);
      }
    } catch (err) {
      console.error(err);
      setError(err instanceof Error ? err.message : "Generate failed.");
    } finally {
      setBusy(false);
    }
  };

  const input = (
    label: string,
    key: keyof Form,
    type: "text" | "date" | "number" = "text",
    placeholder?: string
  ) => (
    <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
      <span style={{ fontSize: 11, fontWeight: 500, color: "var(--fg-subtle)" }}>
        {label.toUpperCase()}
      </span>
      <input
        type={type}
        value={form[key] as string}
        placeholder={placeholder}
        onChange={(e) => update(key, e.target.value as Form[typeof key])}
        style={inputStyle}
      />
    </label>
  );

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
      <div
        className="card"
        style={{ padding: 20, display: "grid", gap: 14, gridTemplateColumns: "repeat(2, 1fr)" }}
      >
        {input("Invoice #", "invoiceNumber")}
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
          {input("Date", "invoiceDate", "date")}
          {input("Due", "dueDate", "date")}
        </div>
      </div>

      <div
        className="card"
        style={{ padding: 20, display: "grid", gap: 14, gridTemplateColumns: "1fr 1fr" }}
      >
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          {input("From (your business)", "fromName")}
          <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            <span style={{ fontSize: 11, fontWeight: 500, color: "var(--fg-subtle)" }}>ADDRESS</span>
            <textarea
              value={form.fromAddress}
              onChange={(e) => update("fromAddress", e.target.value)}
              rows={3}
              style={{ ...inputStyle, resize: "vertical" }}
            />
          </label>
          {input("GSTIN (optional)", "fromGstin")}
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          {input("Bill To (your customer)", "toName")}
          <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            <span style={{ fontSize: 11, fontWeight: 500, color: "var(--fg-subtle)" }}>ADDRESS</span>
            <textarea
              value={form.toAddress}
              onChange={(e) => update("toAddress", e.target.value)}
              rows={3}
              style={{ ...inputStyle, resize: "vertical" }}
            />
          </label>
          {input("GSTIN (optional)", "toGstin")}
        </div>
      </div>

      <div className="card" style={{ padding: 20, display: "flex", flexDirection: "column", gap: 10 }}>
        <div style={{ fontSize: 12, fontWeight: 500, color: "var(--fg-subtle)" }}>LINE ITEMS</div>
        {items.map((it) => (
          <div
            key={it.id}
            style={{
              display: "grid",
              gridTemplateColumns: "1fr 80px 120px 120px 40px",
              gap: 8,
              alignItems: "center",
            }}
          >
            <input
              type="text"
              placeholder="Description"
              value={it.description}
              onChange={(e) => updateItem(it.id, { description: e.target.value })}
              style={inputStyle}
            />
            <input
              type="number"
              min={0}
              step={1}
              value={it.quantity}
              onChange={(e) => updateItem(it.id, { quantity: Number(e.target.value) || 0 })}
              style={inputStyle}
            />
            <input
              type="number"
              min={0}
              step={0.01}
              value={it.unitPrice}
              onChange={(e) => updateItem(it.id, { unitPrice: Number(e.target.value) || 0 })}
              style={inputStyle}
            />
            <div style={{ textAlign: "right", fontFamily: "var(--font-mono), ui-monospace, monospace", fontSize: 13 }}>
              {fmt(it.quantity * it.unitPrice)}
            </div>
            <button
              type="button"
              className="btn btn-sm btn-ghost"
              onClick={() => removeItem(it.id)}
              disabled={items.length <= 1}
              aria-label="Remove item"
            >
              <I.X size={12} />
            </button>
          </div>
        ))}
        <div style={{ display: "flex", justifyContent: "flex-start", marginTop: 4 }}>
          <button type="button" className="btn btn-sm btn-ghost" onClick={addItem}>
            <I.Plus size={12} />
            <span>Add item</span>
          </button>
        </div>
      </div>

      <div
        className="card"
        style={{ padding: 20, display: "grid", gap: 14, gridTemplateColumns: "1fr 1fr 1fr" }}
      >
        <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          <span style={{ fontSize: 11, fontWeight: 500, color: "var(--fg-subtle)" }}>CURRENCY</span>
          <select
            value={form.currency}
            onChange={(e) => update("currency", e.target.value as Form["currency"])}
            style={inputStyle}
          >
            <option value="INR">INR ₹</option>
            <option value="USD">USD $</option>
            <option value="EUR">EUR €</option>
            <option value="GBP">GBP £</option>
          </select>
        </label>
        <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          <span style={{ fontSize: 11, fontWeight: 500, color: "var(--fg-subtle)" }}>TAX MODE</span>
          <select
            value={form.taxMode}
            onChange={(e) => update("taxMode", e.target.value as Form["taxMode"])}
            style={inputStyle}
          >
            <option value="none">No tax</option>
            <option value="cgst-sgst">CGST + SGST (intra-state)</option>
            <option value="igst">IGST (inter-state)</option>
          </select>
        </label>
        <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          <span style={{ fontSize: 11, fontWeight: 500, color: "var(--fg-subtle)" }}>TAX RATE (%)</span>
          <input
            type="number"
            min={0}
            max={28}
            step={0.5}
            value={form.taxRatePct}
            disabled={form.taxMode === "none"}
            onChange={(e) => update("taxRatePct", Number(e.target.value) || 0)}
            style={inputStyle}
          />
        </label>
      </div>

      <div className="card" style={{ padding: 20 }}>
        <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          <span style={{ fontSize: 11, fontWeight: 500, color: "var(--fg-subtle)" }}>NOTES (optional)</span>
          <textarea
            value={form.notes}
            onChange={(e) => update("notes", e.target.value)}
            rows={3}
            style={{ ...inputStyle, resize: "vertical" }}
            placeholder="Payment terms, bank details, thank-you note…"
          />
        </label>
      </div>

      <div className="card" style={{ padding: 16, display: "flex", gap: 20, flexWrap: "wrap", justifyContent: "flex-end" }}>
        <div style={{ textAlign: "right", fontSize: 13 }}>
          <div className="muted">Subtotal: {fmt(subtotal)}</div>
          {form.taxMode !== "none" && <div className="muted">Tax: {fmt(tax)}</div>}
          <div style={{ fontSize: 18, fontWeight: 700, marginTop: 4 }}>Total: {fmt(total)}</div>
        </div>
      </div>

      {error && (
        <p role="alert" style={{ color: "var(--red)", fontSize: 13, margin: 0 }}>
          {error}
        </p>
      )}

      {result && (
        <div
          className="card"
          style={{
            padding: 20,
            borderColor: "var(--accent)",
            background: "var(--accent-soft)",
          }}
        >
          <div className="row" style={{ gap: 12, alignItems: "flex-start" }}>
            <div style={{ width: 36, height: 36, borderRadius: 8, background: "var(--accent)", color: "var(--bg-1)", display: "grid", placeItems: "center" }}>
              <I.Check size={18} />
            </div>
            <div style={{ flex: 1 }}>
              <div style={{ fontWeight: 500, fontSize: 15 }}>Invoice generated</div>
              <div className="muted" style={{ fontSize: 13 }}>
                {result.name} · {humanSize(result.size)}
              </div>
            </div>
            <button type="button" className="btn btn-primary" onClick={() => downloadBytes(result.bytes, result.name)}>
              <I.Download size={14} />
              <span>Download</span>
            </button>
          </div>
        </div>
      )}

      <div className="row" style={{ gap: 10, justifyContent: "flex-end" }}>
        <button type="button" className="btn btn-primary" disabled={busy} onClick={generate}>
          {busy ? "Generating…" : "Generate invoice"}
        </button>
      </div>
    </div>
  );
}

const inputStyle: React.CSSProperties = {
  padding: "8px 10px",
  borderRadius: "var(--radius)",
  border: "1px solid var(--border-strong)",
  background: "var(--bg-1)",
  color: "var(--fg)",
  fontSize: 14,
  width: "100%",
};
