"use client";

import Link from "next/link";
import type { ReactNode } from "react";
import { useSession } from "next-auth/react";

/**
 * SmartCta — a session-aware Link.
 *
 * When the user is logged in, swap the href/label to point them at their
 * dashboard (or wherever `authedHref` says) instead of /register or /login.
 * Falls back to the anonymous variant while the session is loading so we
 * don't ship a flicker.
 *
 * IMPORTANT: All props are React-serializable (strings + ReactNode). Do NOT
 * change `iconBefore`/`iconAfter` to function-as-children — that would break
 * Server→Client RSC serialization for every page that consumes this from a
 * Server Component (pricing, landing FinalCTA, etc.). Lesson learned hard
 * during the 2026-04-19 deploy stall.
 *
 * Usage:
 *   <SmartCta
 *     anon={{ href: "/register", label: "Get started free" }}
 *     authed={{ href: "/app/dashboard", label: "Open dashboard" }}
 *     className="btn btn-lg btn-primary"
 *     iconAfter={<I.ArrowRight size={16} />}
 *   />
 */
export function SmartCta({
  anon,
  authed,
  className,
  style,
  iconBefore,
  iconAfter,
}: {
  anon: { href: string; label: string };
  authed: { href: string; label: string };
  className?: string;
  style?: React.CSSProperties;
  iconBefore?: ReactNode;
  iconAfter?: ReactNode;
}) {
  const { status } = useSession();
  const useAuthed = status === "authenticated";
  const target = useAuthed ? authed : anon;
  return (
    <Link href={target.href} className={className} style={style}>
      {iconBefore ? <>{iconBefore} </> : null}
      {target.label}
      {iconAfter ? <> {iconAfter}</> : null}
    </Link>
  );
}
