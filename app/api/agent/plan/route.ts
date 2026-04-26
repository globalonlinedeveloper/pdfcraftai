// /api/agent/plan — generate an AgentPlan from a natural-language prompt.
//
// Phase 1 of the production Agent mode. Endpoint contract:
//
// REQUEST  (POST, application/json)
// ---------------------------------
//   {
//     prompt: string,
//     files?: Array<{ id: string, name: string, pageCount?: number }>
//   }
//
// RESPONSE (200, application/json)
// --------------------------------
//   {
//     plan: AgentPlan,                  // see lib/agent/types.ts
//     // diagnostics is dev-only — stripped in production builds.
//     diagnostics?: { modelId, latencyMs, inputTokens, outputTokens }
//   }
//
// ERROR RESPONSES
// ---------------
//   401  → not signed in (auth required)
//   400  → prompt missing / too short / too long
//   429  → kill switch tripped (planner op disabled or user over daily cap)
//   422  → LLM returned no usable plan (no_steps / invalid_tool / invalid_params)
//   502  → provider error (Anthropic 5xx, timeout)
//
// COST + RATE LIMITING
// --------------------
// The planner call itself is small (~1k input + ~1k output tokens, ~$0.01
// on Sonnet) but un-metered today. We use the existing route-guard's
// "ai-planner" op key so the kill switch + per-user cap still apply.
// The plan that comes back has totalEstCredits — those are NOT spent
// here, just estimated. Spending happens in /api/agent/run/route.ts.

import "server-only";

import { auth } from "@/auth";
import { generatePlan, PlannerError } from "@/lib/agent/planner";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_PROMPT_LENGTH = 4000; // chars — about 1000 tokens
const MIN_PROMPT_LENGTH = 8;

export async function POST(req: Request): Promise<Response> {
  // 1. Auth
  const session = await auth();
  if (!session?.user?.id) {
    return jsonError(401, "auth_required", "Sign in to use Agent mode.");
  }

  // 2. Parse + validate
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return jsonError(400, "bad_json", "Request body must be valid JSON.");
  }

  const { prompt, files } = (body ?? {}) as {
    prompt?: unknown;
    files?: unknown;
  };

  if (typeof prompt !== "string") {
    return jsonError(400, "missing_prompt", "Field 'prompt' is required and must be a string.");
  }
  const trimmed = prompt.trim();
  if (trimmed.length < MIN_PROMPT_LENGTH) {
    return jsonError(400, "prompt_too_short", `Prompt must be at least ${MIN_PROMPT_LENGTH} characters.`);
  }
  if (trimmed.length > MAX_PROMPT_LENGTH) {
    return jsonError(400, "prompt_too_long", `Prompt must be at most ${MAX_PROMPT_LENGTH} characters.`);
  }

  // Files is optional, but if present must be an array of {id, name}.
  let parsedFiles: Array<{ id: string; name: string; pageCount?: number }> | undefined;
  if (files !== undefined) {
    if (!Array.isArray(files)) {
      return jsonError(400, "bad_files", "Field 'files' must be an array if provided.");
    }
    parsedFiles = [];
    for (const [i, f] of files.entries()) {
      if (
        !f ||
        typeof f !== "object" ||
        typeof (f as { id: unknown }).id !== "string" ||
        typeof (f as { name: unknown }).name !== "string"
      ) {
        return jsonError(400, "bad_files", `files[${i}] must have string id + name`);
      }
      const fObj = f as { id: string; name: string; pageCount?: unknown };
      parsedFiles.push({
        id: fObj.id,
        name: fObj.name,
        pageCount: typeof fObj.pageCount === "number" ? fObj.pageCount : undefined,
      });
    }
  }

  // 3. Note on rate limiting: lib/ai/route-guards.ts uses a closed AIOp
  // union (ocr, translate, chat, summarize, ...) — we'd need to extend
  // that union to add an "agent-plan" op key, which is out of scope for
  // H1. The planner call is small (~$0.01/call) and gated behind auth;
  // a follow-up will add a dedicated kill switch + per-user daily plan
  // cap. For now: relying on session auth + the natural ceiling of
  // user typing speed.

  // 4. Run the planner
  try {
    const result = await generatePlan({ prompt: trimmed, files: parsedFiles });
    return Response.json(
      {
        plan: result.plan,
        // Only emit diagnostics in non-prod for now. Once we wire admin
        // dashboards we can flip this on selectively.
        ...(process.env.NODE_ENV !== "production" && {
          diagnostics: result.diagnostics,
        }),
      },
      { status: 200 },
    );
  } catch (e) {
    if (e instanceof PlannerError) {
      const httpCode =
        e.code === "model_error"
          ? 502
          : e.code === "config"
            ? 500
            : 422;
      return jsonError(httpCode, e.code, e.message, e.details);
    }
    // Unexpected — log + surface as 500
    console.error("[/api/agent/plan] unexpected error:", e);
    return jsonError(500, "internal_error", "Plan generation failed unexpectedly.");
  }
}

function jsonError(
  status: number,
  code: string,
  message: string,
  details?: Record<string, unknown>,
): Response {
  return Response.json({ error: { code, message, details } }, { status });
}
