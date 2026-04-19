import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { db, schema } from "@/db/client";
import { eq } from "drizzle-orm";
import { ProfileForm } from "@/components/app/settings/ProfileForm";
import { PasswordForm } from "@/components/app/settings/PasswordForm";
import { DeleteAccountForm } from "@/components/app/settings/DeleteAccountForm";

export const metadata: Metadata = {
  title: "Settings",
  robots: { index: false, follow: false },
};

export const dynamic = "force-dynamic";

export default async function SettingsPage() {
  const session = await auth();
  const userId = session?.user ? (session.user as { id?: string }).id : undefined;
  if (!userId) redirect("/login");

  const [user] = await db
    .select({
      id: schema.users.id,
      name: schema.users.name,
      email: schema.users.email,
      passwordHash: schema.users.passwordHash,
    })
    .from(schema.users)
    .where(eq(schema.users.id, userId))
    .limit(1);

  if (!user) redirect("/login");

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 28, maxWidth: 680 }}>
      <header>
        <div className="eyebrow" style={{ marginBottom: 6 }}>SETTINGS</div>
        <h1 style={{ fontSize: 28, letterSpacing: "-0.02em" }}>Account settings</h1>
        <p className="muted" style={{ fontSize: 14, marginTop: 4 }}>
          Manage your profile, password, and account data.
        </p>
      </header>

      <section className="card" style={{ padding: 24 }}>
        <h2 style={sectionHeading}>Profile</h2>
        <ProfileForm name={user.name ?? ""} email={user.email} />
      </section>

      <section className="card" style={{ padding: 24 }}>
        <h2 style={sectionHeading}>Password</h2>
        <PasswordForm hasPassword={Boolean(user.passwordHash)} />
      </section>

      <section
        className="card"
        style={{
          padding: 24,
          borderColor: "var(--red)",
        }}
      >
        <h2 style={{ ...sectionHeading, color: "var(--red)" }}>Danger zone</h2>
        <DeleteAccountForm email={user.email} />
      </section>
    </div>
  );
}

const sectionHeading: React.CSSProperties = {
  fontSize: 16,
  letterSpacing: "-0.01em",
  margin: "0 0 16px",
};
