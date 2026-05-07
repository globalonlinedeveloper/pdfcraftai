// PairwiseGraderForm — client form for /admin/evals/grade-pairwise.
// Posts to /api/admin/evals/grade-pairwise (graderUserId from
// session, anti-impersonation).

"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";

interface Initial {
  op: string;
  fixtureId: string;
  leftProviderId: string;
  leftModel: string;
  rightProviderId: string;
  rightModel: string;
}

type Preference = "left" | "right" | "tie" | "both_bad" | "";

const PREF_LABELS: Record<Exclude<Preference, "">, string> = {
  left: "Left wins",
  right: "Right wins",
  tie: "Tie — both equivalent",
  both_bad: "Both unacceptable",
};

export function PairwiseGraderForm({ initial }: { initial: Initial }) {
  const router = useRouter();
  const [op, setOp] = useState(initial.op);
  const [fixtureId, setFixtureId] = useState(initial.fixtureId);
  const [leftProviderId, setLeftProviderId] = useState(initial.leftProviderId);
  const [leftModel, setLeftModel] = useState(initial.leftModel);
  const [rightProviderId, setRightProviderId] = useState(
    initial.rightProviderId,
  );
  const [rightModel, setRightModel] = useState(initial.rightModel);
  const [leftOutputExcerpt, setLeftOutputExcerpt] = useState("");
  const [rightOutputExcerpt, setRightOutputExcerpt] = useState("");
  const [preference, setPreference] = useState<Preference>("");
  const [leftScore, setLeftScore] = useState<number | null>(null);
  const [rightScore, setRightScore] = useState<number | null>(null);
  const [notes, setNotes] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const [pending, startTransition] = useTransition();

  function reset() {
    setLeftOutputExcerpt("");
    setRightOutputExcerpt("");
    setPreference("");
    setLeftScore(null);
    setRightScore(null);
    setNotes("");
    setSuccess(false);
    setError(null);
  }

  async function submit(replace: boolean) {
    setError(null);
    setSuccess(false);
    if (!preference) {
      setError("Pick a preference (left / right / tie / both bad).");
      return;
    }
    startTransition(async () => {
      try {
        const res = await fetch("/api/admin/evals/grade-pairwise", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            goldenSetId: fixtureId,
            op,
            leftProviderId,
            leftModel,
            rightProviderId,
            rightModel,
            preference,
            leftOverallScore: leftScore,
            rightOverallScore: rightScore,
            notes: notes.trim() || null,
            leftOutputExcerpt: leftOutputExcerpt.trim() || null,
            rightOutputExcerpt: rightOutputExcerpt.trim() || null,
            replace,
          }),
        });
        const body = (await res.json().catch(() => ({}))) as {
          ok?: boolean;
          error?: string;
          detail?: string;
        };
        if (res.ok && body.ok) {
          setSuccess(true);
          setTimeout(() => {
            router.push("/admin/evals");
          }, 800);
          return;
        }
        if (res.status === 409) {
          setError(
            (body.detail ??
              "A grade already exists for this combo.") +
              " — click 'Replace prior grade' to overwrite.",
          );
          return;
        }
        setError(
          body.detail ?? body.error ?? `Save failed (HTTP ${res.status}).`,
        );
      } catch {
        setError("Network error — try again.");
      }
    });
  }

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        submit(false);
      }}
      style={{ display: "flex", flexDirection: "column", gap: 20 }}
    >
      {/* Header — op + fixture */}
      <section className="card" style={{ padding: 16 }}>
        <h2 style={{ fontSize: 14, fontWeight: 700, margin: "0 0 10px" }}>
          Op + fixture
        </h2>
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "1fr 1fr",
            gap: 12,
          }}
        >
          <Field label="Op (e.g. summarize)">
            <input
              type="text"
              value={op}
              onChange={(e) => setOp(e.target.value)}
              required
            />
          </Field>
          <Field label="Fixture id (golden_set_id)">
            <input
              type="text"
              value={fixtureId}
              onChange={(e) => setFixtureId(e.target.value)}
              required
            />
          </Field>
        </div>
      </section>

      {/* Two-column side-by-side */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "1fr 1fr",
          gap: 16,
        }}
      >
        <ConfigColumn
          label="LEFT"
          providerId={leftProviderId}
          setProviderId={setLeftProviderId}
          model={leftModel}
          setModel={setLeftModel}
          outputExcerpt={leftOutputExcerpt}
          setOutputExcerpt={setLeftOutputExcerpt}
          score={leftScore}
          setScore={setLeftScore}
        />
        <ConfigColumn
          label="RIGHT"
          providerId={rightProviderId}
          setProviderId={setRightProviderId}
          model={rightModel}
          setModel={setRightModel}
          outputExcerpt={rightOutputExcerpt}
          setOutputExcerpt={setRightOutputExcerpt}
          score={rightScore}
          setScore={setRightScore}
        />
      </div>

      {/* Preference */}
      <section className="card" style={{ padding: 16 }}>
        <h2 style={{ fontSize: 14, fontWeight: 700, margin: "0 0 10px" }}>
          Preference
        </h2>
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(4, 1fr)",
            gap: 8,
          }}
        >
          {(Object.keys(PREF_LABELS) as Array<keyof typeof PREF_LABELS>).map(
            (k) => (
              <label
                key={k}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 6,
                  padding: "10px 12px",
                  border:
                    preference === k
                      ? "2px solid var(--accent)"
                      : "1px solid var(--border)",
                  borderRadius: 6,
                  cursor: "pointer",
                  fontSize: 13,
                  background:
                    preference === k
                      ? "color-mix(in oklab, var(--accent) 8%, transparent)"
                      : "transparent",
                }}
              >
                <input
                  type="radio"
                  name="preference"
                  value={k}
                  checked={preference === k}
                  onChange={() => setPreference(k)}
                />
                {PREF_LABELS[k]}
              </label>
            ),
          )}
        </div>
      </section>

      {/* Notes */}
      <section className="card" style={{ padding: 16 }}>
        <Field label="Notes (optional)">
          <textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            rows={3}
            placeholder="Why this preference? Any patterns to flag?"
          />
        </Field>
      </section>

      {error ? (
        <div
          role="alert"
          style={{
            padding: "10px 14px",
            borderRadius: 6,
            background: "color-mix(in oklab, #c00 8%, transparent)",
            color: "#c00",
            fontSize: 13,
          }}
        >
          {error}
        </div>
      ) : null}

      {success ? (
        <div
          role="status"
          style={{
            padding: "10px 14px",
            borderRadius: 6,
            background: "color-mix(in oklab, #4caf50 12%, transparent)",
            color: "#2e7d32",
            fontSize: 13,
          }}
        >
          ✓ Pairwise grade saved. Redirecting to /admin/evals…
        </div>
      ) : null}

      <div style={{ display: "flex", gap: 8 }}>
        <button
          type="submit"
          className="btn btn-primary"
          disabled={pending || !preference}
        >
          {pending ? "Saving…" : "Save grade"}
        </button>
        {error?.includes("already exists") ? (
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
          onClick={reset}
          disabled={pending}
        >
          Reset form
        </button>
      </div>
    </form>
  );
}

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
      <span style={{ fontSize: 12, fontWeight: 600 }}>{label}</span>
      <span
        style={{
          display: "block",
          width: "100%",
        }}
      >
        {children}
      </span>
    </label>
  );
}

function ConfigColumn({
  label,
  providerId,
  setProviderId,
  model,
  setModel,
  outputExcerpt,
  setOutputExcerpt,
  score,
  setScore,
}: {
  label: string;
  providerId: string;
  setProviderId: (s: string) => void;
  model: string;
  setModel: (s: string) => void;
  outputExcerpt: string;
  setOutputExcerpt: (s: string) => void;
  score: number | null;
  setScore: (n: number | null) => void;
}) {
  return (
    <section
      className="card"
      style={{
        padding: 16,
        display: "flex",
        flexDirection: "column",
        gap: 12,
      }}
    >
      <h2
        style={{
          fontSize: 12,
          fontWeight: 700,
          letterSpacing: 0.4,
          margin: 0,
          color: "var(--accent)",
        }}
      >
        {label}
      </h2>
      <Field label="Provider id (e.g. anthropic, openai, gemini)">
        <input
          type="text"
          value={providerId}
          onChange={(e) => setProviderId(e.target.value)}
          required
        />
      </Field>
      <Field label="Model (e.g. claude-haiku-4-5)">
        <input
          type="text"
          value={model}
          onChange={(e) => setModel(e.target.value)}
          required
        />
      </Field>
      <Field label="AI output excerpt (paste here)">
        <textarea
          value={outputExcerpt}
          onChange={(e) => setOutputExcerpt(e.target.value)}
          rows={8}
          style={{
            fontFamily: "ui-monospace, SFMono-Regular, monospace",
            fontSize: 12,
          }}
        />
      </Field>
      <Field label="Absolute score (1-5, optional)">
        <div style={{ display: "flex", gap: 6 }}>
          {[null, 1, 2, 3, 4, 5].map((n) => (
            <button
              type="button"
              key={String(n)}
              onClick={() => setScore(n)}
              className="btn btn-outline"
              style={{
                fontSize: 12,
                padding: "4px 10px",
                background:
                  score === n
                    ? "color-mix(in oklab, var(--accent) 14%, transparent)"
                    : "transparent",
                borderColor:
                  score === n ? "var(--accent)" : "var(--border)",
              }}
            >
              {n === null ? "—" : n}
            </button>
          ))}
        </div>
      </Field>
    </section>
  );
}
