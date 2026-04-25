// lib/analytics.ts — Typed GA4 event tracker.
//
// Thin wrapper around window.dataLayer for sending custom events.
// gtag() pushes to dataLayer; we push directly to dataLayer because
// the gtag function isn't always defined when consent is "essential"
// only — direct pushes are the safer pattern.
//
// All tracking is gated on consent: events are silently dropped if
// the cookie consent level is anything other than "all".
//
// Naming convention follows GA4's Recommended Events guidance:
// - snake_case event names
// - parameters also snake_case
// - bounded vocabulary for event names so reports stay tidy

declare global {
  interface Window {
    dataLayer?: unknown[];
  }
}

/**
 * Tool-related events. Add new event types here so we don't drift.
 */
export type AnalyticsEvent =
  | { event: "tool_view"; tool_id: string; tool_group: string; from: "tool_runner" | "seo_landing" | "tools_index" }
  | { event: "tool_upload"; tool_id: string; file_size_kb: number; page_count?: number }
  | {
      event: "tool_run_success";
      tool_id: string;
      depth?: string;
      credit_cost: number;
      page_count?: number;
      processing_ms?: number;
    }
  | {
      event: "tool_run_error";
      tool_id: string;
      depth?: string;
      error_code: string;
      page_count?: number;
    }
  | { event: "signup_redirect"; tool_id: string; from_path: string }
  | { event: "credits_purchased"; package_id: string; price_inr: number }
  | { event: "subscription_started"; plan_id: string };

/**
 * Push a typed event to GA4 / dataLayer. No-ops in SSR (window
 * undefined) and when dataLayer hasn't been initialised yet
 * (consent not granted, or layout's analytics block hasn't fired).
 *
 * Returns true when the event was queued, false when dropped — useful
 * for tests and for debugging in dev console.
 */
export function track(payload: AnalyticsEvent): boolean {
  if (typeof window === "undefined") return false;
  if (!Array.isArray(window.dataLayer)) {
    // Not initialised. Could be consent=essential / consent=none, or
    // the analytics block hasn't loaded yet. Drop silently.
    return false;
  }
  try {
    window.dataLayer.push(payload);
    if (
      typeof process !== "undefined" &&
      process.env.NODE_ENV === "development"
    ) {
      // Only log in dev; production console stays clean.
      console.debug("[analytics]", payload.event, payload);
    }
    return true;
  } catch {
    return false;
  }
}
