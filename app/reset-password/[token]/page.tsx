import type { Metadata } from "next";
import Link from "next/link";
import { AuthShell } from "@/components/auth/AuthShell";
import { ResetPasswordForm } from "@/components/auth/ResetPasswordForm";
import { lookupPasswordResetToken } from "@/lib/password-reset";
import { I } from "@/components/icons/Icons";

export const metadata: Metadata = {
  title: "Choose a new password",
  description: "Set a new password for your pdfcraft ai account.",
  robots: { index: false, follow: false },
};

// Force dynamic — token validity is per-request and we never want this
// page cached at the edge with a stale (or worse, leaked) verdict.
export const dynamic = "force-dynamic";

type RouteParams = {
  params: { token: string };
};

export default async function ResetPasswordPage({ params }: RouteParams) {
  const lookup = await lookupPasswordResetToken(params.token);

  if (!lookup.ok) {
    return (
      <AuthShell
        eyebrow="ACCOUNT RECOVERY"
        title="This reset link won't work"
        subtitle="Reset links are single-use and expire 30 minutes after they're sent."
        sidePanel="forgot"
        footer={
          <>
            Need a new one?{" "}
            <Link
              href="/forgot-password"
              style={{ color: "var(--accent)", textDecoration: "none", fontWeight: 500 }}
            >
              Send another reset email
            </Link>
          </>
        }
      >
        <div
          role="status"
          style={{
            padding: 16,
            borderRadius: 10,
            border: "1px solid var(--border)",
            background: "var(--bg-2)",
            display: "flex",
            gap: 12,
            alignItems: "flex-start",
          }}
        >
          <span
            aria-hidden
            style={{
              width: 32,
              height: 32,
              borderRadius: 8,
              background: "color-mix(in oklab, var(--danger, #ef4444) 18%, transparent)",
              color: "var(--danger, #ef4444)",
              display: "grid",
              placeItems: "center",
              flexShrink: 0,
            }}
          >
            <I.Info size={16} />
          </span>
          <div>
            <p style={{ margin: 0, fontSize: 14, fontWeight: 500 }}>
              Link is invalid or expired
            </p>
            <p
              className="muted"
              style={{ margin: "6px 0 0", fontSize: 13, lineHeight: 1.5 }}
            >
              This usually means the link is older than 30 minutes, was already
              used, or is from a different reset request. Request a new email
              and we'll send you a fresh one.
            </p>
          </div>
        </div>
      </AuthShell>
    );
  }

  return (
    <AuthShell
      eyebrow="ACCOUNT RECOVERY"
      title="Choose a new password"
      subtitle="Pick something at least 8 characters long. The link expires in 30 minutes."
      sidePanel="forgot"
      footer={
        <>
          Remembered the old one?{" "}
          <Link
            href="/login"
            style={{ color: "var(--accent)", textDecoration: "none", fontWeight: 500 }}
          >
            Back to sign in
          </Link>
        </>
      }
    >
      <ResetPasswordForm token={params.token} />
    </AuthShell>
  );
}
