"use client";

import { useActionState, useEffect, useRef } from "react";
import { Clock, MailX, TriangleAlert } from "lucide-react";
import { toast } from "sonner";

import { StatusBadge } from "@/components/shared/status-badge";
import { Button } from "@/components/ui/button";
import { Section } from "@/components/shared/section";
import { ROLE_LABELS } from "@/lib/auth/roles";
import {
  revokeInvitationAction,
  type TeamActionState,
} from "@/lib/team/actions";
import type { PendingInvitation } from "@/services/team";

const initialState: TeamActionState = { status: "idle" };

/**
 * Invitations awaiting acceptance.
 *
 * Kept separate from the member roster: these people are not yet part of the
 * practice, and mixing them in would overstate the team's size.
 */
export function PendingInvitations({
  invitations,
}: {
  invitations: PendingInvitation[];
}) {
  const [state, formAction] = useActionState(revokeInvitationAction, initialState);
  const seen = useRef<TeamActionState>(state);

  useEffect(() => {
    if (state === seen.current || state.status === "idle" || !state.message) return;
    seen.current = state;
    if (state.status === "error") toast.error(state.message);
    else toast.success(state.message);
  }, [state]);

  if (invitations.length === 0) return null;

  return (
    <Section
      title="Pending invitations"
      description={`${invitations.length} ${
        invitations.length === 1 ? "invitation" : "invitations"
      } waiting to be accepted.`}
    >
      <ul className="divide-y overflow-hidden rounded-xl border bg-card">
        {invitations.map((invitation) => (
          <li
            key={invitation.id}
            className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between"
          >
            <div className="min-w-0 space-y-1">
              <p className="type-body font-medium break-words">{invitation.email}</p>
              <p className="type-caption">
                {ROLE_LABELS[invitation.role]}
                {invitation.invitedByName
                  ? ` · invited by ${invitation.invitedByName}`
                  : null}
              </p>
            </div>

            <div className="flex items-center gap-3">
              {invitation.expired ? (
                <StatusBadge tone="warning">Expired</StatusBadge>
              ) : (
                <StatusBadge tone="info">
                  Expires {formatDate(invitation.expiresAt)}
                </StatusBadge>
              )}

              <form action={formAction}>
                <input
                  type="hidden"
                  name="invitationId"
                  value={invitation.id}
                />
                <Button type="submit" variant="ghost" size="sm">
                  <MailX className="size-4" aria-hidden="true" />
                  Revoke
                </Button>
              </form>
            </div>
          </li>
        ))}
      </ul>

      {invitations.some((invitation) => invitation.expired) ? (
        <p className="type-caption flex items-center gap-1.5">
          <TriangleAlert className="size-3.5 shrink-0" aria-hidden="true" />
          Expired invitations can no longer be accepted. Invite the person again
          to send a fresh link.
        </p>
      ) : (
        <p className="type-caption flex items-center gap-1.5">
          <Clock className="size-3.5 shrink-0" aria-hidden="true" />
          Invitations expire 7 days after they are sent.
        </p>
      )}
    </Section>
  );
}

function formatDate(date: Date): string {
  return new Date(date).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
  });
}
