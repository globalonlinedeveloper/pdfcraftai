import type { Metadata } from "next";
import Link from "next/link";
import { AuthShell } from "@/components/auth/AuthShell";
import { RegisterForm } from "@/components/auth/RegisterForm";

export const metadata: Metadata = {
  title: "Create account",
  description: "Create your pdfcraft ai account.",
  robots: { index: false, follow: false },
};

export default function RegisterPage() {
  return (
    <AuthShell
      eyebrow="GET STARTED"
      title="Create your account"
      subtitle="Free forever for merge, split, convert, and compress."
      footer={
        <>
          Already have an account?{" "}
          <Link href="/login" style={{ color: "var(--accent)", textDecoration: "none" }}>
            Sign in
          </Link>
        </>
      }
    >
      <RegisterForm />
    </AuthShell>
  );
}
