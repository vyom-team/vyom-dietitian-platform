import type { Metadata } from "next";
import Link from "next/link";
import { Building2, MailWarning } from "lucide-react";

import { AcceptInvitationForm } from "@/components/team/accept-invitation-form";
import { BrandMark } from "@/components/layout/brand-mark";
import { Button } from "@/components/ui/button";
import { getCurrentUser } from "@/lib/auth/dal";
import { ROLE_LABELS } from "@/lib/auth/roles";
import { findInvitationByToken } from "@/services/team";

export const metadata: Metadata = { title: "Join a practice", robots: { index: false } };

/**
 * Invitation acceptance.
 *
 * Deliberately outside the dashboard and onboarding route groups: the visitor
 * may be signed out, may have no practice, or may already belong to another
 * one, and none of those guards apply here.
 *
 * The token is in the path rather than a query string, which keeps it out of
 * `Referer` headers on outbound links.
 *
 * Always dynamic — the page reflects both the invitation state and the viewer's
 * session, neither of which may be cached.
 */
export const dynamic = "force-dynamic";

export default async function InvitePage({ params }: PageProps<"/invite/[token]">) {
  const { token } = await params;
  const [lookup, user] = await Promise.all([
    findInvitationByToken(token),
    getCurrentUser(),
  ]);

  if (!lookup.ok) {
    return <InvitationProblem reason={lookup.reason} />;
  }

  const invitation = lookup.invitation;
  const signedInAsInvitee =
    user?.email.toLowerCase() === invitation.email.toLowerCase();

  return (
    <Shell>
      <div className="space-y-2 text-center">
        <span className="mx-auto flex size-11 items-center justify-center rounded-xl bg-accent text-accent-foreground">
          <Building2 className="size-5" aria-hidden="true" />
        </span>
        <h1 className="type-h2 pt-2">Join {invitation.organizationName}</h1>
        <p className="type-body text-pretty text-muted-foreground">
          {invitation.invitedByName
            ? `${invitation.invitedByName} invited you`
            : "You've been invited"}{" "}
          to join as a {ROLE_LABELS[invitation.role].toLowerCase()}.
        </p>
      </div>

      {invitation.message ? (
        <blockquote className="type-body-sm rounded-lg border-l-2 border-border bg-muted/50 px-4 py-3 text-pretty text-muted-foreground">
          {invitation.message}
        </blockquote>
      ) : null}

      <dl className="divide-y rounded-xl border bg-card px-5">
        <Row label="Practice" value={invitation.organizationName} />
        <Row label="Role" value={ROLE_LABELS[invitation.role]} />
        <Row label="Invited email" value={invitation.email} />
        <Row
          label="Expires"
          value={invitation.expiresAt.toLocaleDateString("en-GB", {
            day: "numeric",
            month: "long",
            year: "numeric",
          })}
        />
      </dl>

      {!user ? (
        /*
         * Signed out. The invited address may or may not have an account, so
         * both routes are offered. `next` carries the invitation back here
         * afterwards and is validated as an internal path before use.
         */
        <div className="space-y-3">
          <p className="type-body-sm text-center text-muted-foreground">
            Sign in as <strong>{invitation.email}</strong> to accept, or create
            an account with that address.
          </p>
          <div className="flex flex-col gap-2 sm:flex-row">
            <Button className="flex-1" asChild>
              <Link href={`/login?next=${encodeURIComponent(`/invite/${token}`)}`}>
                Sign in
              </Link>
            </Button>
            <Button variant="outline" className="flex-1" asChild>
              <Link href={`/register?next=${encodeURIComponent(`/invite/${token}`)}`}>
                Create an account
              </Link>
            </Button>
          </div>
        </div>
      ) : signedInAsInvitee ? (
        <AcceptInvitationForm
          token={token}
          practiceName={invitation.organizationName}
        />
      ) : (
        /*
         * Signed in as somebody else. Email binding means this session cannot
         * accept, so say so plainly rather than showing a button that will fail.
         */
        <div className="space-y-3 rounded-lg border border-warning/25 bg-warning-subtle p-4">
          <p className="type-body-sm text-warning">
            You&apos;re signed in as <strong>{user.email}</strong>, but this
            invitation was sent to <strong>{invitation.email}</strong>.
          </p>
          <p className="type-body-sm text-warning">
            Sign out and sign back in with the invited address to accept it.
          </p>
        </div>
      )}
    </Shell>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="grid gap-0.5 py-3 sm:grid-cols-3 sm:gap-4">
      <dt className="type-caption sm:pt-0.5">{label}</dt>
      <dd className="type-body break-words sm:col-span-2">{value}</dd>
    </div>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-svh flex-col">
      <header className="flex h-16 items-center px-6">
        <Link
          href="/"
          className="rounded-md outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
        >
          <BrandMark />
          <span className="sr-only">Vyom home</span>
        </Link>
      </header>
      <main className="flex flex-1 justify-center px-4 pb-16">
        <div className="w-full max-w-md space-y-6">{children}</div>
      </main>
    </div>
  );
}

/**
 * Failure states.
 *
 * All four say roughly the same thing and none confirms whether a token ever
 * existed, so the page cannot be used to probe for valid tokens.
 */
function InvitationProblem({
  reason,
}: {
  reason: "not-found" | "expired" | "revoked" | "accepted";
}) {
  const copy: Record<typeof reason, { title: string; body: string }> = {
    "not-found": {
      title: "This invitation isn't valid",
      body: "The link may be incorrect or the invitation may have been withdrawn. Ask whoever invited you to send a new one.",
    },
    expired: {
      title: "This invitation has expired",
      body: "Invitations are valid for 7 days. Ask whoever invited you to send a new one.",
    },
    revoked: {
      title: "This invitation was withdrawn",
      body: "The practice cancelled this invitation. Get in touch with them if you think that's a mistake.",
    },
    accepted: {
      title: "This invitation has already been used",
      body: "If that was you, sign in to reach the practice. Invitation links work only once.",
    },
  };

  const { title, body } = copy[reason];

  return (
    <Shell>
      <div className="space-y-3 pt-8 text-center">
        <span className="mx-auto flex size-11 items-center justify-center rounded-xl bg-muted text-muted-foreground">
          <MailWarning className="size-5" aria-hidden="true" />
        </span>
        <h1 className="type-h2 pt-2">{title}</h1>
        <p className="type-body text-pretty text-muted-foreground">{body}</p>
        <div className="pt-4">
          <Button variant="outline" asChild>
            <Link href="/login">Go to sign in</Link>
          </Button>
        </div>
      </div>
    </Shell>
  );
}
