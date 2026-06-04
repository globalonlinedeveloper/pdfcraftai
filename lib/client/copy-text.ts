// lib/client/copy-text.ts
//
// Robust clipboard copy shared by every tool's "Copy" button.
//
// Drop-in for `navigator.clipboard.writeText`: tries the async
// Clipboard API first, then falls back to the legacy execCommand
// path (works in non-secure contexts / when the async API is blocked
// by permissions policy), and THROWS only if BOTH fail — so existing
// `try { await copyText(x); setCopied(true) } catch {}` call sites keep
// their exact behaviour while gaining the fallback for free.
//
// Why a shared helper: 13 call sites used to inline `writeText` with no
// fallback, so a blocked async API silently did nothing. One helper +
// one CI guard (scripts/test-clipboard-helper.mjs) keeps them all robust.
export async function copyText(text: string): Promise<void> {
  // 1) Async Clipboard API (HTTPS + user gesture).
  try {
    if (typeof navigator !== "undefined" && navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return;
    }
  } catch {
    // fall through to the legacy path
  }
  // 2) Legacy execCommand fallback.
  try {
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.setAttribute("readonly", "");
    ta.style.position = "fixed";
    ta.style.top = "0";
    ta.style.left = "0";
    ta.style.opacity = "0";
    document.body.appendChild(ta);
    ta.focus();
    ta.select();
    const ok = document.execCommand("copy");
    document.body.removeChild(ta);
    if (ok) return;
  } catch {
    // fall through to throw
  }
  throw new Error("copy_failed");
}
