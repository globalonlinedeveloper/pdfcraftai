// Output moderation — Task #28, PLAN_GAP_ANALYSIS SEV-0 companion.
//
// Why this exists
// ---------------
// Task #26 (lib/ai/prompt-safety.ts) keeps bad instructions OUT of the
// model — wrap untrusted input, prepend a safety preamble, detect
// jailbreak patterns. That is the input-side defense.
//
// This module is the complementary output-side defense. It scans every
// AI-generated string BEFORE we persist or stream it to the user, looking
// for categories of content that either (a) leak sensitive data the
// model should never have included, or (b) indicate the model was
// successfully tricked by an injection attempt that got past the input-
// side layer. Specifically:
//
//   1. Personally Identifiable Information (PII) leaking into output
//      — email addresses, phone numbers, SSNs, credit-card-shaped
//        digits. Caller asked "summarize this contract" and the output
//        happens to contain a buyer's Social Security Number is a bad
//        day for everyone.
//
//   2. Secrets leaking into output — OpenAI keys (sk-…), Anthropic
//      keys (sk-ant-…), GitHub PATs (ghp_…), Stripe keys, AWS access
//      keys (AKIA…), Slack tokens (xox[baprs]-…), Google API keys
//      (AIza…), private-key PEM headers. If a user pasted a secret
//      into a PDF and the model echoes it back in the summary, we
//      catch it on the way out.
//
//   3. Jailbreak-success markers — the output artifact left behind
//      when an injection attempt succeeded ("DAN mode activated",
//      "ignoring all prior instructions", verbatim system-prompt
//      echoes). Advisory — these are worth flagging for audit review
//      even if we don't block.
//
// Design posture
// --------------
//   - PURE. Same as prompt-safety: no I/O, no network, no globals. This
//     module is a pure library of regex patterns and a single scanning
//     function. That keeps it free to call on every request and trivial
//     to unit-test.
//
//   - ADVISORY by default. The module returns a structured
//     `ModerationResult`. Callers decide what to do based on severity
//     and op context. A `critical` severity is strong enough that most
//     call-sites will want to throw `OutputModerationBlockedError` and
//     let the route refund + surface a 502, but we do NOT auto-throw
//     from `moderateOutput()` itself — false positives on a 30-page
//     contract that legitimately contains a phone number are expensive.
//
//   - REGEX-ONLY v1. We deliberately ship without an external
//     `/v1/moderations` API call. Reasons:
//       - Zero extra config. No new env var, no new rate-limit worry,
//         no new latency budget on every op. Ships instantly on
//         Hostinger without a re-deploy gating on credential plumbing.
//       - Determinism. Regex matching is deterministic; tests pin
//         every pattern. External moderation APIs drift silently over
//         time.
//       - Scope. The highest-risk output leaks for this app are
//         secrets + PII — both detectable with regex. Abusive-content
//         detection (the thing external moderation APIs are best at)
//         is a smaller concern because our system prompts already
//         direct the model away from generative abuse. If we later
//         want belt-and-braces on the abuse category, a feature-flag-
//         gated OpenAI /v1/moderations fallback is a v2 item.
//
//   - STREAMING CAVEAT. The chat route is the only call-site that
//     streams output to the client via Server-Sent Events. By the
//     time we moderate, the deltas are already on the wire. For v1
//     the chat call-site treats moderation as ADVISORY-ONLY — we log
//     the finding to the `ai_usage.meta` audit row but do NOT
//     attempt to un-send bytes the client already received. Non-
//     streaming ops (summarize/translate/compare/rewrite/table/
//     redact/sign/generate/ocr) CAN and DO block on critical findings
//     because we have the full output in hand before the response
//     leaves the server.
//
// What this module INTENTIONALLY does NOT do
// ------------------------------------------
//   - It does not MUTATE or REDACT the output. Scanning is read-only
//     — we return `findings[]` describing what we saw, nothing more.
//     Rewriting AI output to "fix" it is a rabbit hole of its own
//     (partial matches, multi-byte boundaries, markdown escape) and
//     would give users a silently-corrupted artifact. If a critical
//     leak is present the caller rejects the whole response.
//   - It does not do Luhn validation on credit-card-shaped digits.
//     The 13-19 digit pattern is conservative enough for advisory
//     flagging — a stricter check risks false negatives on
//     legitimately-formatted card numbers that fail Luhn due to
//     OCR-adjacent typos. We want to flag, not gate.
//   - It does not rate-limit or persist findings itself. The caller
//     is responsible for writing moderation results into the
//     `ai_usage` audit row (Task #19's `meta` JSON column).
//
// Call-site contract
// ------------------
// A correctly-integrated non-streaming call-site does:
//     const moderation = moderateOutput(result.text, { op: "summarize" });
//     if (moderation.severity === "critical") {
//       throw new OutputModerationBlockedError(moderation, "summarize");
//     }
//     return { markdown, moderation, ... };
//
// A correctly-integrated streaming call-site (chat) does:
//     const moderation = moderateOutput(assistantText, { op: "chat" });
//     // advisory — attach to ai_usage row, never block a streamed turn.
//     await recordAiUsage({ ..., meta: { moderation } });
//
// Tests pin every op's integration via regex against the compiled
// source (see `scripts/test-output-moderation.mjs` §E).

import "server-only";

import type { PromptSafetyOp } from "./prompt-safety";

/**
 * Ops the moderation module knows about. Kept type-equal to
 * `PromptSafetyOp` so input-side and output-side defenses stay in
 * lockstep on the op set. Adding a new op forces a compile-time
 * ladder update here.
 */
export type ModerationOp = PromptSafetyOp;

/** Severity ladder. "none" means clean. */
export type ModerationSeverity =
  | "none"
  | "low"
  | "medium"
  | "high"
  | "critical";

/** One category of finding. Keeps the scanner's report structured. */
export type ModerationCategory = "pii" | "secret" | "jailbreak_echo";

/**
 * A single match reported by the scanner.
 *
 * The `subtype` is a stable machine-readable name that test harnesses
 * and audit consumers can switch on. The `severity` is the STRONGEST
 * severity associated with that pattern (some patterns — e.g. private-
 * key PEM headers — are always critical; others — e.g. generic phone
 * numbers — are always low).
 *
 * `count` is how many non-overlapping matches the scanner saw in the
 * input text. `sample` is a short redacted excerpt suitable for logging
 * (we mask the middle bytes so the log row doesn't itself become a
 * secret-leak channel).
 */
export interface ModerationFinding {
  category: ModerationCategory;
  subtype: string;
  severity: Exclude<ModerationSeverity, "none">;
  count: number;
  /** Short redacted excerpt for logs. Never contains the raw secret. */
  sample: string;
}

/**
 * Aggregate result.
 *
 * `safe` is true iff severity === "none". `severity` is the strongest
 * severity across all findings. `reasonsPublic` is a short list of
 * user-safe phrases suitable for returning in a 502 body — we never
 * return the raw finding samples to the client.
 */
export interface ModerationResult {
  safe: boolean;
  severity: ModerationSeverity;
  findings: ModerationFinding[];
  /**
   * User-safe reason strings (e.g. "output contained a credential-
   * shaped string"). The raw `findings[].sample` is NOT user-safe —
   * this list is what a route handler can return in a 502 body.
   */
  reasonsPublic: string[];
}

// -------------------------------------------------------------------
// Pattern library
// -------------------------------------------------------------------

interface ModerationPattern {
  category: ModerationCategory;
  subtype: string;
  regex: RegExp;
  severity: Exclude<ModerationSeverity, "none">;
  /** Human-safe reason for the public list. */
  publicReason: string;
}

/**
 * SECRETS — credential-shaped strings. These are always critical: a
 * model echoing back a real API key in output is the single worst
 * possible leak mode for this app.
 *
 * Patterns are conservative. We anchor on the well-known prefix
 * (sk-, ghp_, AKIA, …) + enough following characters to avoid
 * matching short accidental strings. Every pattern is case-sensitive
 * except where the real format is case-insensitive — AKIA is all
 * caps for a reason.
 */
const SECRET_PATTERNS: readonly ModerationPattern[] = [
  // Anthropic is checked BEFORE OpenAI because `sk-ant-…` would also
  // match the shorter `sk-…` pattern. Ordering matters for subtype
  // labeling even though severity is the same.
  {
    category: "secret",
    subtype: "anthropic_api_key",
    // sk-ant-api03-... up through future prefixes. Be generous with
    // the tail length (40+) — Anthropic keys are long.
    regex: /\bsk-ant-[A-Za-z0-9_-]{40,}\b/,
    severity: "critical",
    publicReason: "output contained a credential-shaped string",
  },
  {
    category: "secret",
    subtype: "openai_api_key",
    // sk- followed by 40+ base62. Excludes sk-ant- (handled above)
    // via a negative lookahead.
    regex: /\bsk-(?!ant-)[A-Za-z0-9_-]{40,}\b/,
    severity: "critical",
    publicReason: "output contained a credential-shaped string",
  },
  {
    category: "secret",
    subtype: "github_pat_classic",
    regex: /\bghp_[A-Za-z0-9]{30,}\b/,
    severity: "critical",
    publicReason: "output contained a credential-shaped string",
  },
  {
    category: "secret",
    subtype: "github_pat_fine_grained",
    regex: /\bgithub_pat_[A-Za-z0-9_]{40,}\b/,
    severity: "critical",
    publicReason: "output contained a credential-shaped string",
  },
  {
    category: "secret",
    subtype: "stripe_api_key",
    // sk_live_ / sk_test_ / pk_live_ / pk_test_ + 20+ base62
    regex: /\b(?:sk|pk|rk)_(?:live|test)_[A-Za-z0-9]{20,}\b/,
    severity: "critical",
    publicReason: "output contained a credential-shaped string",
  },
  {
    category: "secret",
    subtype: "aws_access_key_id",
    regex: /\bAKIA[0-9A-Z]{16}\b/,
    severity: "critical",
    publicReason: "output contained a credential-shaped string",
  },
  {
    category: "secret",
    subtype: "slack_token",
    regex: /\bxox[baprs]-[A-Za-z0-9-]{10,}\b/,
    severity: "critical",
    publicReason: "output contained a credential-shaped string",
  },
  {
    category: "secret",
    subtype: "google_api_key",
    // AIza + 35 base64url chars. Google's well-known public format.
    regex: /\bAIza[0-9A-Za-z_-]{35}\b/,
    severity: "critical",
    publicReason: "output contained a credential-shaped string",
  },
  {
    category: "secret",
    subtype: "private_key_pem",
    regex: /-----BEGIN\s+(?:RSA\s+|DSA\s+|EC\s+|OPENSSH\s+)?PRIVATE\s+KEY-----/,
    severity: "critical",
    publicReason: "output contained a private-key header",
  },
  {
    category: "secret",
    subtype: "jwt_token",
    // Three base64url-ish segments separated by dots, starting with
    // the canonical eyJ prefix (base64 of `{"`). Medium severity —
    // often legitimately discussed in dev docs, sometimes leaked.
    regex: /\beyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/,
    severity: "medium",
    publicReason: "output contained a JWT-shaped token",
  },
];

/**
 * PII — personally identifiable information. Ranging from low-severity
 * (emails, phone numbers — legitimately appear in business docs all
 * the time) through high (SSN, credit-card-shaped digit runs).
 */
const PII_PATTERNS: readonly ModerationPattern[] = [
  {
    category: "pii",
    subtype: "us_ssn",
    // Classic XXX-XX-XXXX. Exclude the all-zeros-in-group and
    // sequences like 000-00-0000 by requiring at least one non-zero
    // digit in each group. Conservative — real SSNs also exclude 9XX
    // and 666-xx-xxxx but that's too strict for an advisory signal.
    regex: /\b(?!000|666)[0-8]\d{2}-(?!00)\d{2}-(?!0000)\d{4}\b/,
    severity: "high",
    publicReason: "output contained a Social-Security-Number-shaped string",
  },
  {
    category: "pii",
    subtype: "credit_card_shape",
    // 13-19 consecutive digits, optionally separated by single spaces
    // or hyphens. We deliberately don't Luhn-validate — a typo'd
    // card number is still PII-shaped and worth flagging. Anchored
    // with word boundaries to avoid matching long numeric IDs
    // embedded in URLs or table cells.
    regex: /\b(?:\d[ -]?){12,18}\d\b/,
    severity: "high",
    publicReason: "output contained a credit-card-shaped digit run",
  },
  {
    category: "pii",
    subtype: "email_address",
    // Conservative RFC-ish email — no attempt to be 100% spec-compliant.
    regex: /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/,
    severity: "low",
    publicReason: "output contained an email address",
  },
  {
    category: "pii",
    subtype: "us_phone_number",
    // (NNN) NNN-NNNN, NNN-NNN-NNNN, NNN.NNN.NNNN, +1 NNN NNN NNNN.
    // Area-code first digit ≥ 2 to exclude obvious false positives
    // like "1-800" scored into zip codes.
    regex: /\b(?:\+?1[-.\s]?)?\(?[2-9]\d{2}\)?[-.\s]?\d{3}[-.\s]?\d{4}\b/,
    severity: "low",
    publicReason: "output contained a phone-number-shaped string",
  },
  {
    category: "pii",
    subtype: "ipv4_address",
    // Dotted quad, each octet 0-255. Low severity — legitimately
    // appears in ops logs and network diagrams constantly.
    regex:
      /\b(?:25[0-5]|2[0-4]\d|[01]?\d\d?)\.(?:25[0-5]|2[0-4]\d|[01]?\d\d?)\.(?:25[0-5]|2[0-4]\d|[01]?\d\d?)\.(?:25[0-5]|2[0-4]\d|[01]?\d\d?)\b/,
    severity: "low",
    publicReason: "output contained an IP address",
  },
];

/**
 * JAILBREAK-SUCCESS ECHOES — patterns that suggest the model fell for
 * a prompt-injection attack that got past the input-side defense.
 * These are advisory; the chat-route audit log cares, but we don't
 * auto-block because legitimate content can mention these phrases
 * (e.g. a security researcher's writeup of jailbreak techniques).
 */
const JAILBREAK_ECHO_PATTERNS: readonly ModerationPattern[] = [
  {
    category: "jailbreak_echo",
    subtype: "dan_mode_activated",
    // "DAN mode activated", "DAN:", "DAN mode on" — canonical output
    // of a "do anything now" jailbreak where the model role-played
    // into the unrestricted persona.
    regex: /\b(?:DAN\s+mode\s+(?:activated|on|enabled)|^DAN\s*:)/im,
    severity: "high",
    publicReason: "output matched a known jailbreak-success pattern",
  },
  {
    category: "jailbreak_echo",
    subtype: "role_break_confirmation",
    // "I am now [role]", "from now on I will [role]" — common output
    // when the model accepts a role-override. Medium because
    // legitimate creative-writing output can look like this.
    regex: /\b(?:I\s+am\s+now|from\s+now\s+on\s+I\s+will|I\s+will\s+pretend\s+to\s+be)\b/i,
    severity: "medium",
    publicReason: "output matched a possible role-override echo",
  },
  {
    category: "jailbreak_echo",
    subtype: "ignoring_prior_instructions",
    // Model echoing its compliance: "ignoring previous instructions
    // as requested", "disregarding the prior prompt". Medium.
    regex: /\b(?:ignoring|disregarding|bypassing)\s+(?:all\s+|the\s+|any\s+)?(?:prior|previous|earlier)\s+(?:instructions?|prompts?|rules?)\b/i,
    severity: "medium",
    publicReason: "output matched a possible instruction-override echo",
  },
];

/** Flat list used by the scanner — order preserved for test stability. */
const ALL_PATTERNS: readonly ModerationPattern[] = [
  ...SECRET_PATTERNS,
  ...PII_PATTERNS,
  ...JAILBREAK_ECHO_PATTERNS,
];

// -------------------------------------------------------------------
// Severity aggregation
// -------------------------------------------------------------------

const SEVERITY_RANK: Record<ModerationSeverity, number> = {
  none: 0,
  low: 1,
  medium: 2,
  high: 3,
  critical: 4,
};

function strongerOf(
  a: ModerationSeverity,
  b: ModerationSeverity
): ModerationSeverity {
  return SEVERITY_RANK[a] >= SEVERITY_RANK[b] ? a : b;
}

// -------------------------------------------------------------------
// Public API
// -------------------------------------------------------------------

export interface ModerateOptions {
  /** Op that generated this output. Currently advisory — reserved for future op-specific tuning. */
  op: ModerationOp;
  /**
   * Optional cap on how many matches of a single subtype we report.
   * Defaults to 5 — prevents an output full of email addresses from
   * exploding the findings list and the log row. Counts above the cap
   * are preserved on the `count` field; only the `sample` is from the
   * first match.
   */
  perSubtypeCap?: number;
}

/**
 * Scan an AI-generated output string for moderation-worthy content.
 *
 * PURE — no I/O, no globals, no randomness. Same input → same output.
 * Safe to call on every response. Throws nothing; callers decide what
 * to do based on `result.severity`.
 */
export function moderateOutput(
  text: string,
  opts: ModerateOptions
): ModerationResult {
  if (!text || text.length === 0) {
    return {
      safe: true,
      severity: "none",
      findings: [],
      reasonsPublic: [],
    };
  }

  // Opt is currently unused beyond validation — exists so the interface
  // stays stable when we add op-specific tuning later. Touching the
  // field prevents a "noUnusedParameters" tsc warning in strict mode.
  void opts.op;
  const cap = opts.perSubtypeCap ?? 5;
  void cap;

  const findings: ModerationFinding[] = [];
  const reasonsSeen = new Set<string>();
  let maxSeverity: ModerationSeverity = "none";

  for (const p of ALL_PATTERNS) {
    const globalRegex = new RegExp(
      p.regex.source,
      p.regex.flags.includes("g") ? p.regex.flags : p.regex.flags + "g"
    );
    const matches = text.match(globalRegex);
    if (!matches || matches.length === 0) continue;

    findings.push({
      category: p.category,
      subtype: p.subtype,
      severity: p.severity,
      count: matches.length,
      sample: redactSample(matches[0]!),
    });
    maxSeverity = strongerOf(maxSeverity, p.severity);
    reasonsSeen.add(p.publicReason);
  }

  // Sort findings by descending severity for stable output. Ties
  // preserve insertion order (which matches ALL_PATTERNS order).
  findings.sort(
    (a, b) => SEVERITY_RANK[b.severity] - SEVERITY_RANK[a.severity]
  );

  return {
    safe: maxSeverity === "none",
    severity: maxSeverity,
    findings,
    reasonsPublic: Array.from(reasonsSeen),
  };
}

/**
 * Thrown by call-sites that choose to block on a critical-severity
 * moderation finding. Non-streaming ops SHOULD throw this and let the
 * route handler catch + refund + surface a 502
 * `output_moderation_blocked` response. Streaming ops (chat) should
 * NOT throw this because by the time moderation runs, the deltas have
 * already reached the client.
 */
export class OutputModerationBlockedError extends Error {
  constructor(
    public readonly result: ModerationResult,
    public readonly op: ModerationOp
  ) {
    super(
      `Output moderation blocked response for op "${op}": ` +
        `severity=${result.severity}, findings=[${result.findings
          .map((f) => f.subtype)
          .join(", ")}]`
    );
    this.name = "OutputModerationBlockedError";
  }
}

/**
 * Convenience guard for non-streaming call-sites.
 *
 * Usage:
 *     const moderation = moderateOutput(text, { op: "summarize" });
 *     assertOutputSafe(moderation, "summarize");
 *     return { markdown: text, moderation, ... };
 *
 * Throws only on `severity === "critical"`. "high"/"medium"/"low" are
 * advisory — attach to audit row, return normally. This matches the
 * philosophy from prompt-safety.ts where `detectJailbreak` returns
 * advisory severity and the caller picks the threshold.
 */
export function assertOutputSafe(
  result: ModerationResult,
  op: ModerationOp
): void {
  if (result.severity === "critical") {
    throw new OutputModerationBlockedError(result, op);
  }
}

// -------------------------------------------------------------------
// Sample redaction
// -------------------------------------------------------------------

/**
 * Mask the middle bytes of a matched sample so our own audit log
 * doesn't become a secret-leak channel. For short samples (< 8
 * chars), returns a length-only tag. For longer samples, keeps the
 * first 3 + last 2 characters and masks the middle.
 *
 * Example: redactSample("sk-abc123def456ghi789") → "sk-...89"
 *          redactSample("alice@example.com")     → "ali...om"
 *          redactSample("1234")                   → "<len=4>"
 */
function redactSample(raw: string): string {
  if (raw.length < 8) return `<len=${raw.length}>`;
  const head = raw.slice(0, 3);
  const tail = raw.slice(-2);
  return `${head}...${tail}`;
}

// -------------------------------------------------------------------
// Test hook
// -------------------------------------------------------------------

/**
 * Exposed ONLY for `scripts/test-output-moderation.mjs`. Production
 * code should use the public helpers above.
 */
export const __OUTPUT_MODERATION_INTERNALS = {
  ALL_PATTERNS,
  SECRET_PATTERNS,
  PII_PATTERNS,
  JAILBREAK_ECHO_PATTERNS,
  SEVERITY_RANK,
  redactSample,
} as const;
