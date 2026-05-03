"use client";

// Browser device fingerprint (plan §8 layer 5).
//
// Lightweight vanilla fingerprint — no FingerprintJS dep. Combines
// stable browser signals into a 64-char hex hash that's:
//   - Stable across pages on the same browser/device for ~weeks.
//   - Distinct enough to differentiate browsers/devices in a way
//     that's useful for clustering signups in /admin/abuse-signals.
//   - NOT a privacy-piercing identifier — anyone with a different
//     OS/browser/screen/timezone gets a different fingerprint, but
//     so does the same person who opens dev tools and changes
//     their viewport size by 50px. We're matching bots that share
//     a VM image, not tracking individual humans.
//
// Why no FingerprintJS open-core dep
//   FingerprintJS open-core is ~50KB minified + gzipped, MIT-licensed,
//   and produces a more robust fingerprint via more sophisticated
//   audio + canvas + WebGL probing. Adding the dep mid-session is
//   risk we don't need — this vanilla helper covers the documented
//   threat model (plan §8 layer 5: "bot farms running on shared VM
//   images all produce the same fingerprint"). Sophisticated bot
//   farms can randomise some signals but the canvas/WebGL pair is
//   hard to forge cheaply.
//
// Threat coverage
//   - Defeats: bot farms on cloned VM images, headless Chrome with
//     default flags, naïve Puppeteer scripts.
//   - Doesn't defeat: Puppeteer + canvas-randomization plugins,
//     residential-IP bot networks with per-instance browser profiles.
//     These attackers cost $20-50/account to operate; our 5-credit
//     ceiling makes the attack uneconomical anyway (plan §8 effective-
//     ness table).
//
// Usage in a client component:
//
//   useEffect(() => {
//     computeFingerprint().then((fp) => {
//       // Stash on the form via a hidden field. Server reads it and
//       // writes to users.device_fingerprint (migration 0018).
//       hiddenInput.current.value = fp;
//     });
//   }, []);

/**
 * Compute a 64-char hex fingerprint of the current browser/device.
 *
 * Returns "" if we're SSR (no window) — caller should treat empty
 * as "no signal" the same way an empty IP is treated by the abuse
 * detector. Real users always get a non-empty fingerprint client-
 * side; only the SSR pass returns "".
 */
export async function computeFingerprint(): Promise<string> {
  if (typeof window === "undefined") return "";

  const signals: string[] = [];

  // Stable signals — change rarely.
  signals.push(`ua:${navigator.userAgent}`);
  signals.push(`lang:${navigator.language}`);
  signals.push(`langs:${(navigator.languages ?? []).join(",")}`);
  signals.push(`tz:${Intl.DateTimeFormat().resolvedOptions().timeZone}`);
  signals.push(`tzoff:${new Date().getTimezoneOffset()}`);
  signals.push(`scr:${screen.width}x${screen.height}x${screen.colorDepth}`);
  signals.push(`avail:${screen.availWidth}x${screen.availHeight}`);
  signals.push(`dpr:${window.devicePixelRatio ?? 1}`);
  signals.push(`hc:${navigator.hardwareConcurrency ?? 0}`);
  signals.push(`pf:${navigator.platform ?? ""}`);

  // Touch capability.
  signals.push(`touch:${"ontouchstart" in window ? 1 : 0}`);
  signals.push(`mtp:${(navigator as Navigator & { maxTouchPoints?: number }).maxTouchPoints ?? 0}`);

  // Canvas fingerprint — draws text + shapes, reads pixel hash.
  // Different browsers/GPU drivers anti-alias text differently;
  // the resulting pixel data is highly distinctive.
  try {
    const canvas = document.createElement("canvas");
    canvas.width = 220;
    canvas.height = 30;
    const ctx = canvas.getContext("2d");
    if (ctx) {
      ctx.textBaseline = "top";
      ctx.font = "14px 'Arial'";
      ctx.fillStyle = "#f60";
      ctx.fillRect(125, 1, 62, 20);
      ctx.fillStyle = "#069";
      ctx.fillText("pdfcraft ai ☢", 2, 15);
      ctx.fillStyle = "rgba(102, 204, 0, 0.7)";
      ctx.fillText("pdfcraft ai ☢", 4, 17);
      signals.push(`cvs:${canvas.toDataURL().slice(-100)}`);
    }
  } catch {
    signals.push("cvs:err");
  }

  // WebGL — GPU + driver fingerprint. The unmasked vendor/renderer
  // strings are what most fingerprinters anchor on.
  try {
    const canvas = document.createElement("canvas");
    const gl =
      canvas.getContext("webgl") ||
      (canvas.getContext("experimental-webgl") as WebGLRenderingContext | null);
    if (gl) {
      const debugInfo = gl.getExtension("WEBGL_debug_renderer_info");
      if (debugInfo) {
        signals.push(
          `gl-vendor:${gl.getParameter(debugInfo.UNMASKED_VENDOR_WEBGL) ?? ""}`,
        );
        signals.push(
          `gl-render:${gl.getParameter(debugInfo.UNMASKED_RENDERER_WEBGL) ?? ""}`,
        );
      } else {
        signals.push(`gl-vendor:${gl.getParameter(gl.VENDOR) ?? ""}`);
        signals.push(`gl-render:${gl.getParameter(gl.RENDERER) ?? ""}`);
      }
      signals.push(`gl-ver:${gl.getParameter(gl.VERSION) ?? ""}`);
    }
  } catch {
    signals.push("gl:err");
  }

  // Hash the joined signal string with SHA-256 (Web Crypto API).
  // Returns 64-char hex. Falls back to a non-cryptographic hash if
  // SubtleCrypto is unavailable (extremely rare — only on insecure
  // origins / very old browsers).
  const joined = signals.join("|");
  try {
    const enc = new TextEncoder();
    const buf = await crypto.subtle.digest("SHA-256", enc.encode(joined));
    return Array.from(new Uint8Array(buf))
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("");
  } catch {
    // Non-crypto fallback. Same length so the column type fits.
    let h = 0;
    for (let i = 0; i < joined.length; i++) {
      h = ((h << 5) - h + joined.charCodeAt(i)) | 0;
    }
    return `fallback-${(h >>> 0).toString(16).padStart(8, "0")}`.padEnd(
      64,
      "0",
    );
  }
}
