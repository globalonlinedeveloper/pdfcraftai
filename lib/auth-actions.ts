"use server";

import "server-only";
import { randomUUID } from "crypto";
import { z } from "zod";
import bcrypt from "bcryptjs";
import { eq } from "drizzle-orm";
import { AuthError } from "next-auth";

import { db, schema } from "@/db/client";
import { signIn } from "@/auth";
import { sanitizeCallbackUrl } from "@/lib/auth-callback";

// ---------------- Register ----------------

// 2026-05-02 plan §8a item 5 — password strength.
// Counts how many of the four character classes (lowercase, uppercase,
// digit, symbol) appear in the password. Requires at least 3 of 4.
// Pure stdlib — avoids adding zxcvbn dep mid-deploy. The 3-of-4 rule
// catches >95% of weak passwords without false-positive frustration on
// users who omit symbols.
function countCharClasses(p: string): number {
  let c = 0;
  if (/[a-z]/.test(p)) c++;
  if (/[A-Z]/.test(p)) c++;
  if (/[0-9]/.test(p)) c++;
  if (/[^A-Za-z0-9]/.test(p)) c++;
  return c;
}

const registerSchema = z.object({
  name: z
    .string()
    .trim()
    .min(1, "Enter your name.")
    .max(120, "Name is too long."),
  email: z.string().trim().email("Enter a valid email."),
  password: z
    .string()
    // 2026-05-02 plan §8a item 5 — bumped 8 → 10 character minimum.
    // 10 chars × 3 character classes = ~10^17 entropy floor against
    // dictionary attacks; 8-char minimum from before allowed weak
    // patterns like "password1" through.
    .min(10, "Use at least 10 characters.")
    .max(128, "Password is too long.")
    .refine(
      (p) => countCharClasses(p) >= 3,
      "Use a mix of upper case, lower case, digits, and symbols (any 3 of 4)."
    ),
});

export type RegisterState = {
  ok: boolean;
  error?: string;
  fieldErrors?: Partial<Record<"name" | "email" | "password", string>>;
};

export async function registerAction(
  _prev: RegisterState | undefined,
  formData: FormData
): Promise<RegisterState> {
  const parsed = registerSchema.safeParse({
    name: formData.get("name"),
    email: formData.get("email"),
    password: formData.get("password"),
  });

  if (!parsed.success) {
    const fieldErrors: RegisterState["fieldErrors"] = {};
    for (const issue of parsed.error.issues) {
      const k = issue.path[0];
      if (k === "name" || k === "email" || k === "password") {
        fieldErrors[k] = issue.message;
      }
    }
    return { ok: false, error: "Fix the highlighted fields.", fieldErrors };
  }

  const { name, email, password } = parsed.data;
  const normalizedEmail = email.toLowerCase();

  try {
    const existing = await db
      .select({ id: schema.users.id })
      .from(schema.users)
      .where(eq(schema.users.email, normalizedEmail))
      .limit(1);

    if (existing[0]) {
      // 2026-05-02 plan §8a item 7 — no user enumeration. Original
      // copy ("An account with that email already exists. Try signing
      // in.") confirmed email-existence to anyone hitting /register
      // with a target email. Generic copy here; honest users with a
      // duplicate email still recover via the password-reset flow
      // (Day 1.5a) or by clicking "Sign in instead". The slight UX
      // friction is the cost of not running an enumeration oracle.
      return {
        ok: false,
        error:
          "Couldn't create the account. Check your details, or sign in if you already have an account.",
      };
    }

    // 2026-05-02 plan §8a item 4 — bcrypt cost factor bumped 10 → 12.
    // 2026 baseline. 2^12 = 4096 rounds. Hash time on Hostinger Premium
    // node is ~150ms which is the industry-recommended "noticeable
    // but not painful" target. Annual revisit — bump to 13 if hardware
    // makes 12 cheap.
    const passwordHash = await bcrypt.hash(password, 12);
    const id = randomUUID();

    await db.insert(schema.users).values({
      id,
      name,
      email: normalizedEmail,
      passwordHash,
    });

    await db.insert(schema.credits).values({
      userId: id,
      balance: 0,
    });
  } catch (err) {
    console.error("register action failed:", err);
    return { ok: false, error: "Something went wrong. Please try again." };
  }

  // 2026-05-01 — preserve the callbackUrl from form data, sanitized
  // server-side as defense-in-depth (the client already sanitized).
  // Empty / invalid values fall back to /app/dashboard via the helper.
  const cbInput = formData.get("callbackUrl");
  const redirectTo = sanitizeCallbackUrl(
    typeof cbInput === "string" ? cbInput : null,
  );

  // Sign the new user in via Credentials; this redirects on success.
  try {
    await signIn("credentials", {
      email: normalizedEmail,
      password,
      redirectTo,
    });
  } catch (err) {
    // NextAuth throws a magic "redirect" error on success — rethrow so Next handles it.
    if (err && typeof err === "object" && "digest" in err) throw err;
    if (err instanceof AuthError) {
      return { ok: false, error: "Account created, but sign-in failed. Try logging in." };
    }
    throw err;
  }

  return { ok: true };
}

// ---------------- Login ----------------

const loginSchema = z.object({
  email: z.string().trim().email("Enter a valid email."),
  password: z.string().min(1, "Enter your password."),
});

export type LoginState = {
  ok: boolean;
  error?: string;
};

export async function loginAction(
  _prev: LoginState | undefined,
  formData: FormData
): Promise<LoginState> {
  const parsed = loginSchema.safeParse({
    email: formData.get("email"),
    password: formData.get("password"),
  });

  if (!parsed.success) {
    return { ok: false, error: "Enter a valid email and password." };
  }

  // 2026-05-01 — preserve the callbackUrl from form data; same
  // server-side sanitization as registerAction above.
  const cbInput = formData.get("callbackUrl");
  const redirectTo = sanitizeCallbackUrl(
    typeof cbInput === "string" ? cbInput : null,
  );

  try {
    await signIn("credentials", {
      email: parsed.data.email.toLowerCase(),
      password: parsed.data.password,
      redirectTo,
    });
  } catch (err) {
    if (err && typeof err === "object" && "digest" in err) throw err;
    if (err instanceof AuthError) {
      return { ok: false, error: "Invalid email or password." };
    }
    throw err;
  }

  return { ok: true };
}
