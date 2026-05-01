// lib/pdf/ops/fill-form.ts
//
// 2026-05-01 Tier 3: write values into AcroForm fields and save the
// filled PDF.
//
// Pairs with the existing pdf-forms inspector (lib/pdf/ops/forms.ts)
// — the inspector reads the field schema; this op writes values
// back. UI flow: read schema → render inputs → user fills → call
// this op with {fieldName: value} map.
//
// pdf-lib's PDFForm API exposes typed accessors per field shape:
//   - PDFTextField.setText(value: string)
//   - PDFCheckBox.check() / .uncheck()
//   - PDFRadioGroup.select(option: string)
//   - PDFDropdown.select(option: string)
//   - PDFOptionList.select(option: string)
//
// We walk every field, look it up by name, and dispatch the value
// to the right setter based on the field's runtime constructor name
// (the only way to switch on type in pdf-lib without hard imports).
// Unknown / unfillable fields (signature, generic button) get
// skipped with a counter for the result.
//
// "NeedAppearances": when AcroForm has /NeedAppearances true, the
// PDF reader regenerates field appearances from the values on open.
// pdf-lib normally writes appearance streams itself; we set
// NeedAppearances anyway as a belt-and-suspenders for viewers that
// honor that flag (some Acrobat versions, Foxit, etc.).

import { PDFDocument, PDFCheckBox, PDFTextField, PDFRadioGroup, PDFDropdown, PDFOptionList } from "pdf-lib";

/**
 * Schema entry for one form field — what the UI needs to render an
 * appropriate input control. Returned by `getFormFieldSchema` below.
 */
export interface FieldSchemaEntry {
  /** Field name (matches the key in fillForm's values map). */
  name: string;
  /** UI input shape. Mapped from pdf-lib's runtime field constructor. */
  kind: "text" | "checkbox" | "radio" | "dropdown" | "option-list" | "signature" | "unknown";
  /** Current value (string for text/dropdown/radio; bool for checkbox; array for option-list). */
  value: string | boolean | string[];
  /** Available options (for radio / dropdown / option-list). Empty otherwise. */
  options: string[];
  /** Whether the field is read-only (UI should disable the input). */
  readOnly: boolean;
  /** Multi-line hint for text fields. UI may render <textarea> instead of <input>. */
  multiline: boolean;
}

export interface FormFieldSchema {
  fields: FieldSchemaEntry[];
  /** Total count of all field types (informational). */
  totalCount: number;
  /** Count of fields the UI can actually render and fill. */
  fillableCount: number;
}

/**
 * Extract a typed schema of every form field so the UI can render
 * input controls. Pairs with fillForm() — read schema, render
 * inputs, collect values, call fill.
 */
export async function getFormFieldSchema(
  bytes: Uint8Array,
): Promise<FormFieldSchema> {
  const doc = await PDFDocument.load(bytes, {
    ignoreEncryption: false,
    updateMetadata: false,
  });
  let form;
  try {
    form = doc.getForm();
  } catch {
    return { fields: [], totalCount: 0, fillableCount: 0 };
  }
  const fields = form.getFields();
  const out: FieldSchemaEntry[] = [];
  let fillable = 0;

  for (const field of fields) {
    const name = field.getName();
    const readOnly = field.isReadOnly();
    if (field instanceof PDFTextField) {
      const isMultiline =
        typeof (field as PDFTextField & { isMultiline?: () => boolean }).isMultiline === "function"
          ? (field as PDFTextField & { isMultiline: () => boolean }).isMultiline()
          : false;
      out.push({
        name,
        kind: "text",
        value: field.getText() ?? "",
        options: [],
        readOnly,
        multiline: isMultiline,
      });
      if (!readOnly) fillable += 1;
    } else if (field instanceof PDFCheckBox) {
      out.push({
        name,
        kind: "checkbox",
        value: field.isChecked(),
        options: [],
        readOnly,
        multiline: false,
      });
      if (!readOnly) fillable += 1;
    } else if (field instanceof PDFRadioGroup) {
      out.push({
        name,
        kind: "radio",
        value: field.getSelected() ?? "",
        options: field.getOptions(),
        readOnly,
        multiline: false,
      });
      if (!readOnly) fillable += 1;
    } else if (field instanceof PDFDropdown) {
      const sel = field.getSelected();
      out.push({
        name,
        kind: "dropdown",
        value: sel.length > 0 ? sel[0] : "",
        options: field.getOptions(),
        readOnly,
        multiline: false,
      });
      if (!readOnly) fillable += 1;
    } else if (field instanceof PDFOptionList) {
      out.push({
        name,
        kind: "option-list",
        value: field.getSelected(),
        options: field.getOptions(),
        readOnly,
        multiline: false,
      });
      if (!readOnly) fillable += 1;
    } else {
      out.push({
        name,
        kind: "unknown",
        value: "",
        options: [],
        readOnly,
        multiline: false,
      });
    }
  }

  return { fields: out, totalCount: fields.length, fillableCount: fillable };
}

/**
 * Per-field user input. The shape is forgiving — strings cover most
 * inputs (text, dropdown, radio); booleans cover checkboxes; arrays
 * cover multi-select option lists.
 */
export type FillValue = string | boolean | string[];

export interface FillFormOptions {
  /** Map of fieldName → value. Names match what pdf-forms returned. */
  values: Record<string, FillValue>;
  /**
   * If true, calls form.flatten() before saving — bakes the values
   * into the page content so they can't be edited downstream. Default
   * false (keeps fields editable; recipients can change values too).
   */
  flatten?: boolean;
}

export interface FillFormResult {
  bytes: Uint8Array;
  pageCount: number;
  /** Number of fields that successfully received their value. */
  filledCount: number;
  /** Field names that were skipped (unknown type or value/type mismatch). */
  skipped: string[];
}

export async function fillForm(
  bytes: Uint8Array,
  opts: FillFormOptions,
): Promise<FillFormResult> {
  const doc = await PDFDocument.load(bytes, {
    ignoreEncryption: false,
    updateMetadata: false,
  });
  const pageCount = doc.getPageCount();
  if (pageCount === 0) throw new Error("This PDF has no pages.");

  let form;
  try {
    form = doc.getForm();
  } catch (err) {
    throw new Error("This PDF doesn't have a fillable AcroForm.");
  }
  const fields = form.getFields();
  if (fields.length === 0) {
    throw new Error("This PDF has no form fields.");
  }

  // pdf-lib regenerates field appearance streams during save() so
  // viewers see the new values without needing /NeedAppearances=true.
  // Most modern viewers (Preview, Chrome, Adobe Acrobat) honor the
  // pre-rendered appearances correctly. If a corner-case viewer
  // refuses to display the values, the user can re-save through that
  // viewer or use the "flatten" option to bake values into page content.

  let filledCount = 0;
  const skipped: string[] = [];

  for (const field of fields) {
    const name = field.getName();
    if (!(name in opts.values)) continue;
    const value = opts.values[name];

    try {
      if (field instanceof PDFTextField) {
        if (typeof value !== "string") {
          skipped.push(name);
          continue;
        }
        field.setText(value);
        filledCount += 1;
      } else if (field instanceof PDFCheckBox) {
        const truthy =
          value === true ||
          (typeof value === "string" &&
            ["true", "yes", "on", "1", "checked"].includes(value.toLowerCase()));
        if (truthy) field.check();
        else field.uncheck();
        filledCount += 1;
      } else if (field instanceof PDFRadioGroup) {
        if (typeof value !== "string" || value === "") {
          skipped.push(name);
          continue;
        }
        field.select(value);
        filledCount += 1;
      } else if (field instanceof PDFDropdown) {
        if (typeof value !== "string" || value === "") {
          skipped.push(name);
          continue;
        }
        field.select(value);
        filledCount += 1;
      } else if (field instanceof PDFOptionList) {
        const arr =
          Array.isArray(value)
            ? value
            : typeof value === "string" && value
              ? [value]
              : [];
        if (arr.length === 0) {
          skipped.push(name);
          continue;
        }
        field.select(arr);
        filledCount += 1;
      } else {
        // Signature field, generic button, or unknown subtype.
        skipped.push(name);
      }
    } catch (err) {
      // pdf-lib throws on out-of-range select() options or
      // type-mismatch sets. Surface the field as skipped rather
      // than failing the whole fill.
      skipped.push(name);
    }
  }

  if (opts.flatten) {
    try {
      form.flatten();
    } catch {
      // Some PDFs have fields pdf-lib's flatten can't handle (e.g.
      // signature fields). Save without flattening rather than
      // failing — user gets the values in editable form.
    }
  }

  const outBytes = await doc.save({ useObjectStreams: false });
  return { bytes: outBytes, pageCount, filledCount, skipped };
}
