// lib/agent/macro-constants.ts
//
// Pure constants for the agent-macro feature. Lives outside macro-bridge.ts
// because that file is "use server" — Next.js's "use server" directive
// only allows exporting async functions, not consts. Splitting the
// constants into a plain module lets both client- and server-side code
// import them without the "use server" restriction.

/**
 * Sentinel `tool_id` value we write into `user_macros` for plan-shaped
 * (agent) macros, so they coexist with per-tool macros (one row per
 * (user_id, tool_id, name) tuple via the unique index).
 */
export const AGENT_MACRO_TOOL_ID = "agent";
