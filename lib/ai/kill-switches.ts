// Task #12 — provider + op kill switches.
//
// Two independent env-controlled gates in front of the router:
//
//   1. Provider kill — `AI_KILL_ANTHROPIC=true`, `AI_KILL_OPENAI=true`,
//      `AI_KILL_GEMINI=true`. Router `route()` skips any killed provider
//      in the ladder, falling through to the next eligible one. If every
//      provider on the ladder is killed, the router throws
//      `NoRoutableProviderError` exactly as it does today when no
//      provider is configured — the route handler maps that to 503
//      `no_ai_provider_configured`. This is deliberate: "the cheapest
//      eligible provider is dead / over quota / being rotated" is
//      operationally equivalent to "we have no provider" from the
//      caller's perspective.
//
//   2. Op kill — `AI_KILL_OCR=true`, `AI_KILL_TRANSLATE=true`, etc. Per
//      AIOp. Returns 503 `op_disabled` at the route-handler layer before
//      we touch credits, the provider, or the database. Operators flip
//      this when an op is causing a cost/quality incident and we want
//      to degrade gracefully (rather than letting customers burn credits
//      on broken output).
//
// Design rules
// ------------
//   - Env reads happen EVERY call — no module-level freeze. This is on
//     purpose: Hostinger reloads env vars on "Save and redeploy" but
//     Node process doesn't always restart if the runtime chooses to
//     reuse a worker. Per-call reads mean a flip takes effect the next
//     request, never caches a stale value.
//   - Truthy values: "true", "1", "yes", "on" (case-insensitive). Anything
//     else — including empty string, "false", "0" — is off. Defaults to
//     OFF if the var is unset. This is permissive on typos (a typo'd
//     "tru" won't accidentally kill the provider) but explicit on the
//     common affirmatives.
//   - Exports pure reader functions only. The router calls `isProviderKilled`
//     during ladder walk; the route handler calls `isOpKilled` before
//     spending credits; the admin page calls `killedProviders()` /
//     `killedOps()` to render status. None of these touch the DB, none
//     require server-only boundaries beyond what their callers already
//     enforce.
//   - No DB writes from this module. Flipping a kill is an operator
//     action via Hostinger env vars; admin UI is read-only by design
//     (Task #12 acceptance criterion — admin page shows state +
//     instructions, does NOT mutate).
//
// Test story
// ----------
// `scripts/test-router.mjs` SECTION G pins:
//   - Exports exist (isProviderKilled, isOpKilled, killedProviders,
//     killedOps, PROVIDER_KILL_ENV_VAR, OP_KILL_ENV_VAR).
//   - Kill env names match the spec (AI_KILL_{UPPER_PROVIDER},
//     AI_KILL_{UPPER_OP}).
//   - Router skips killed providers — env flip simulated by the harness,
//     `resolveLadder()` result filtered through `isProviderKilled` drops
//     the killed id.
// Integration tests (production-only, behind env flag): set
// `AI_KILL_GEMINI=true`, hit /api/ai/ocr, verify primary flips to
// Anthropic instead of 503-ing.

import "server-only";

import type { AIProviderId } from "./types";
import type { AIOp } from "./router";

// -------------------------------------------------------------------
// Env-var name tables — single source of truth for operators.
// -------------------------------------------------------------------

/**
 * Per-provider kill-switch env-var names. An operator flips one of
 * these to `true` in Hostinger → App → Environment Variables and redeploys
 * to temporarily disable that provider across every op. Router ladder
 * walks will skip the provider and fall through to the next eligible one.
 */
export const PROVIDER_KILL_ENV_VAR: Record<AIProviderId, string> = {
  anthropic: "AI_KILL_ANTHROPIC",
  openai: "AI_KILL_OPENAI",
  gemini: "AI_KILL_GEMINI",
};

/**
 * Per-op kill-switch env-var names. An operator flips one of these to
 * `true` to graceful-503 that op — callers get `op_disabled` with no
 * credit spend, no provider call, no ai_usage row. Use when an op is
 * in a cost/quality incident (e.g., OCR returning garbage because
 * Gemini rolled out a bad model version and Anthropic fallback is also
 * regressing).
 *
 * Ordered to match `AIOp` union in router.ts so grep finds them together.
 */
export const OP_KILL_ENV_VAR: Record<AIOp, string> = {
  ocr: "AI_KILL_OCR",
  translate: "AI_KILL_TRANSLATE",
  chat: "AI_KILL_CHAT",
  summarize: "AI_KILL_SUMMARIZE",
  compare: "AI_KILL_COMPARE",
  generate: "AI_KILL_GENERATE",
  sign: "AI_KILL_SIGN",
  rewrite: "AI_KILL_REWRITE",
  table: "AI_KILL_TABLE",
  redact: "AI_KILL_REDACT",
};

// -------------------------------------------------------------------
// Truthy-value parsing
// -------------------------------------------------------------------

/**
 * Permissive truthiness for env-var flips. Accepts "true", "1", "yes",
 * "on" case-insensitively. Everything else — including undefined, empty
 * string, "false", "0", "no", "off", a typo'd "tru" — is off.
 *
 * Exported so the test harness can pin the accepted vocabulary directly.
 */
export function isKillValueTruthy(raw: string | undefined): boolean {
  if (typeof raw !== "string") return false;
  const normalized = raw.trim().toLowerCase();
  return (
    normalized === "true" ||
    normalized === "1" ||
    normalized === "yes" ||
    normalized === "on"
  );
}

// -------------------------------------------------------------------
// Public readers
// -------------------------------------------------------------------

/**
 * Is this provider currently killed by env var?
 *
 * Called from `route()` during the ladder walk. A killed provider is
 * skipped silently — the router continues to the next ladder entry.
 * If every entry is killed, `route()` throws `NoRoutableProviderError`
 * and the route handler returns 503 `no_ai_provider_configured`.
 */
export function isProviderKilled(id: AIProviderId): boolean {
  const envVar = PROVIDER_KILL_ENV_VAR[id];
  if (!envVar) return false; // defensive — unknown provider id
  return isKillValueTruthy(process.env[envVar]);
}

/**
 * Is this op currently killed by env var?
 *
 * Called from the API route handler BEFORE spendCredits. A killed op
 * returns 503 `op_disabled` with a short message + the env-var name so
 * operators can grep logs and trace back to the flip.
 */
export function isOpKilled(op: AIOp): boolean {
  const envVar = OP_KILL_ENV_VAR[op];
  if (!envVar) return false; // defensive — unknown op
  return isKillValueTruthy(process.env[envVar]);
}

/**
 * Snapshot of currently-killed providers. Used by the admin page and
 * /api/health to render operator-visible state. Pure read of env vars
 * at call time; mirrors `isProviderKilled` for every known id.
 */
export function killedProviders(): AIProviderId[] {
  const killed: AIProviderId[] = [];
  for (const id of Object.keys(PROVIDER_KILL_ENV_VAR) as AIProviderId[]) {
    if (isProviderKilled(id)) killed.push(id);
  }
  return killed;
}

/**
 * Snapshot of currently-killed ops. Mirrors `isOpKilled` for every op.
 */
export function killedOps(): AIOp[] {
  const killed: AIOp[] = [];
  for (const op of Object.keys(OP_KILL_ENV_VAR) as AIOp[]) {
    if (isOpKilled(op)) killed.push(op);
  }
  return killed;
}

/**
 * Diagnostic snapshot — every known env-var name + current truthiness.
 * Used by the admin kill-switches page to render the full status table,
 * including unset values (so the operator sees "AI_KILL_OPENAI: off"
 * not just the killed subset).
 */
export function killSwitchSnapshot(): {
  providers: Array<{ id: AIProviderId; envVar: string; killed: boolean }>;
  ops: Array<{ op: AIOp; envVar: string; killed: boolean }>;
} {
  return {
    providers: (Object.keys(PROVIDER_KILL_ENV_VAR) as AIProviderId[]).map((id) => ({
      id,
      envVar: PROVIDER_KILL_ENV_VAR[id],
      killed: isProviderKilled(id),
    })),
    ops: (Object.keys(OP_KILL_ENV_VAR) as AIOp[]).map((op) => ({
      op,
      envVar: OP_KILL_ENV_VAR[op],
      killed: isOpKilled(op),
    })),
  };
}

/**
 * Thrown by the route handler helper `assertOpNotKilled` when an op is
 * killed. The handler catches and returns 503 `op_disabled` with the
 * env-var name in the detail. Separate class from `NoRoutableProviderError`
 * so callers that want different refund/log posture for "op disabled"
 * vs. "no provider has capacity" can distinguish them.
 */
export class OpKilledError extends Error {
  constructor(public readonly op: AIOp, public readonly envVar: string) {
    super(`AI op "${op}" is disabled via ${envVar}=true`);
    this.name = "OpKilledError";
  }
}

/**
 * Route-handler helper. Called right after auth() succeeds, BEFORE we
 * spend credits or touch any provider. Keeps the kill check in one
 * line at the top of every op route.
 */
export function assertOpNotKilled(op: AIOp): void {
  if (isOpKilled(op)) {
    throw new OpKilledError(op, OP_KILL_ENV_VAR[op]);
  }
}
