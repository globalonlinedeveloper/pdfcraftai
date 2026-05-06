// Client form for /admin/evals/grade. Fetches the now-shipped
// POST endpoint at /api/admin/evals/grade (which the
// human-grade-writer module backs).
//
// The form uses native HTML controls — no slider library. Each
// Likert dimension is a 1-5 button row (radio-button-like
// behavior with a more visible click target than a slider for
// 5 discrete values).

"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";

type Score = 1 | 2 | 3 | 4 | 5;

const SCORES: readonly Score[] = [1, 2, 3, 4, 5];

interface FormState {
  goldenSetId: string;
  operation: string;
  providerId: string;
  model: string;
  evalRunId: string;
  scoreRelevance: Score | null;
  scoreCompleteness: Score | null;
  scoreFaithfulness: Score | null;
  scoreActionability: Score | null;
  notes: string;
  aiOutputExcerpt: string;
}

const EMPTY: FormState = {
  goldenSetId: "",
  operation: "",
  providerId: "",
  model: "",
  evalRunId: "",
  scoreRelevance: null,
  scoreCompleteness: null,
  scoreFaithfulness: null,
  scoreActionability: null,
  notes: "",
  aiOutputExcerpt: "",
};

export function GraderForm() {
  const router = useRouter();
  const [form, setForm] = useState<FormState>(EMPTY);
  const [error, setError] = useState<string | null>(null);
  const [conflict, setConflict] = useState(false);
  const [pending, startTransition] = useTransition();

  function set<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((s) => ({ ...s, [key]: value }));
  }

  function submit(replace: boolean) {
    setError(null);
    setConflict(false);
    if (
      form.scoreRelevance === null ||
      form.scoreCompleteness === null ||
      form.scoreFaithfulness === null ||
      form.scoreActionability === null
    ) {
      setError("All four Likert scores are required.");
      return;
    }
    if (
      form.goldenSetId.trim().length === 0 ||
      form.operation.trim().length === 0 ||
      form.providerId.trim().length === 0 ||
      form.model.trim().length === 0
    ) {
      setError("Fixture id / operation / provider / model are all required.");
      return;
    }

    startTransition(async () => {
      const body = {
        goldenSetId: form.goldenSetId.trim(),
        operation: form.operation.trim(),
        providerId: form.providerId.trim(),
        model: form.model.trim(),
        evalRunId: form.evalRunId.trim() || undefined,
        scoreRelevance: form.scoreRelevance,
        scoreCompleteness: form.scoreCompleteness,
        scoreFaithfulness: form.scoreFaithfulness,
        scoreActionability: form.scoreActionability,
        notes: form.notes || undefined,
        aiOutputExcerpt: form.aiOutputExcerpt || undefined,
        replace,
      };
      try {
        const res = await fetch("/api/admin/evals/grade", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(body),
        });
        if (res.status === 409) {
          // Existing grade — surface the "replace?" path.
          setConflict(true);
          return;
        }
        const json = (await res.json()) as {
          ok?: boolean;
          error?: string;
          detail?: string;
        };
        if (!res.ok || !json.ok) {
          setError(
            json.detail || json.error || `HTTP ${res.status}`,
          );
          return;
        }
        router.push("/admin/evals");
      } catch (err) {
        setError(
          err instanceof Error ? err.message : "Network error",
        );
      }
    });
  }

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        submit(false);
      }}
      className="card"
      style={{ padding: 20, maxWidth: 760 }}
    >
      {/* Fixture metadata — text inputs because v1 doesn't ship a
          dropdown of valid golden-set ids yet. */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 16 }}>
        <Field label="Golden-set id">
          <input
            type="text"
            value={form.goldenSetId}
            onChange={(e) => set("goldenSetId", e.target.value)}
            placeholder="summarize.long-doc"
            disabled={pending}
            style={inputStyle}
          />
        </Field>
        <Field label="Operation">
          <input
            type="text"
            value={form.operation}
            onChange={(e) => set("operation", e.target.value)}
            placeholder="summarize"
            disabled={pending}
            style={inputStyle}
          />
        </Field>
        <Field label="Provider">
          <input
            type="text"
            value={form.providerId}
            onChange={(e) => set("providerId", e.target.value)}
            placeholder="anthropic"
            disabled={pending}
            style={inputStyle}
          />
        </Field>
        <Field label="Model">
          <input
            type="text"
            value={form.model}
            onChange={(e) => set("model", e.target.value)}
            placeholder="claude-3-5-haiku"
            disabled={pending}
            style={inputStyle}
          />
        </Field>
        <Field label="ai_eval_runs id (optional)" span={2}>
          <input
            type="text"
            value={form.evalRunId}
            onChange={(e) => set("evalRunId", e.target.value)}
            placeholder="UUID from automated run, or leave blank"
            disabled={pending}
            style={inputStyle}
          />
        </Field>
      </div>

      {/* Likert sliders */}
      <fieldset
        style={{
          border: "1px solid var(--border)",
          borderRadius: 6,
          padding: 12,
          marginBottom: 16,
        }}
      >
        <legend style={{ padding: "0 6px", fontWeight: 600, fontSize: 13 }}>
          Likert scores (1-5)
        </legend>
        <ScoreRow
          label="Relevance"
          desc="Answers what was asked"
          value={form.scoreRelevance}
          onChange={(v) => set("scoreRelevance", v)}
          disabled={pending}
        />
        <ScoreRow
          label="Completeness"
          desc="Covers everything important from the source"
          value={form.scoreCompleteness}
          onChange={(v) => set("scoreCompleteness", v)}
          disabled={pending}
        />
        <ScoreRow
          label="Faithfulness"
          desc="Stays grounded in source; no hallucinations"
          value={form.scoreFaithfulness}
          onChange={(v) => set("scoreFaithfulness", v)}
          disabled={pending}
        />
        <ScoreRow
          label="Actionability"
          desc="Would the user actually act on this?"
          value={form.scoreActionability}
          onChange={(v) => set("scoreActionability", v)}
          disabled={pending}
        />
      </fieldset>

      {/* Notes + excerpt */}
      <Field label="Notes (optional)">
        <textarea
          value={form.notes}
          onChange={(e) => set("notes", e.target.value)}
          rows={3}
          disabled={pending}
          style={{ ...inputStyle, fontFamily: "inherit", resize: "vertical" }}
        />
      </Field>
      <Field label="AI output excerpt (optional, ≤4KB)">
        <textarea
          value={form.aiOutputExcerpt}
          onChange={(e) => set("aiOutputExcerpt", e.target.value.slice(0, 4096))}
          rows={5}
          disabled={pending}
          style={{
            ...inputStyle,
            fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
            fontSize: 12,
            resize: "vertical",
          }}
        />
      </Field>

      {error ? (
        <div
          role="alert"
          className="card"
          style={{
            padding: "10px 12px",
            borderColor: "#c00",
            background: "color-mix(in oklab, #c00 6%, transparent)",
            fontSize: 13,
            marginBottom: 16,
          }}
        >
          {error}
        </div>
      ) : null}

      {conflict ? (
        <div
          role="alert"
          className="card"
          style={{
            padding: "10px 12px",
            borderColor: "#f57c00",
            background: "color-mix(in oklab, #f57c00 8%, transparent)",
            fontSize: 13,
            marginBottom: 16,
          }}
        >
          You&rsquo;ve already graded this combo. Click{" "}
          <strong>Replace prior grade</strong> to overwrite it.
        </div>
      ) : null}

      <div style={{ display: "flex", gap: 8 }}>
        <button
          type="submit"
          className="btn btn-primary"
          disabled={pending}
        >
          {pending && !conflict ? "Submitting…" : "Submit grade"}
        </button>
        {conflict ? (
          <button
            type="button"
            className="btn btn-outline"
            onClick={() => submit(true)}
            disabled={pending}
            style={{ borderColor: "#f57c00", color: "#f57c00" }}
          >
            Replace prior grade
          </button>
        ) : null}
        <button
          type="button"
          className="btn btn-outline"
          onClick={() => router.push("/admin/evals")}
          disabled={pending}
        >
          Cancel
        </button>
      </div>
    </form>
  );
}

function Field({
  label,
  children,
  span,
}: {
  label: string;
  children: React.ReactNode;
  span?: number;
}) {
  return (
    <label
      style={{
        display: "block",
        marginBottom: 12,
        gridColumn: span ? `span ${span}` : undefined,
      }}
    >
      <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 4 }}>
        {label}
      </div>
      {children}
    </label>
  );
}

function ScoreRow({
  label,
  desc,
  value,
  onChange,
  disabled,
}: {
  label: string;
  desc: string;
  value: Score | null;
  onChange: (v: Score) => void;
  disabled: boolean;
}) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 12,
        padding: "8px 0",
        borderBottom: "1px solid var(--border)",
      }}
    >
      <div style={{ minWidth: 200 }}>
        <div style={{ fontSize: 13, fontWeight: 600 }}>{label}</div>
        <div className="muted" style={{ fontSize: 11 }}>{desc}</div>
      </div>
      <div style={{ display: "flex", gap: 4 }}>
        {SCORES.map((n) => (
          <button
            key={n}
            type="button"
            onClick={() => onChange(n)}
            disabled={disabled}
            style={{
              width: 36,
              height: 36,
              borderRadius: 6,
              border:
                value === n
                  ? "1px solid var(--accent)"
                  : "1px solid var(--border)",
              background:
                value === n
                  ? "color-mix(in oklab, var(--accent) 14%, transparent)"
                  : "var(--bg)",
              color: "var(--fg)",
              fontWeight: 600,
              cursor: disabled ? "not-allowed" : "pointer",
            }}
          >
            {n}
          </button>
        ))}
      </div>
    </div>
  );
}

const inputStyle: React.CSSProperties = {
  width: "100%",
  padding: "8px 10px",
  fontSize: 13,
  borderRadius: 4,
  border: "1px solid var(--border)",
  background: "var(--bg)",
  color: "var(--fg)",
};
