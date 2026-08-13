"use client";

import { useActionState, useEffect, useRef } from "react";
import { MoreHorizontal, ShieldCheck, UserMinus, UserRoundCheck } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  changeRoleAction,
  reactivateMemberAction,
  removeMemberAction,
  suspendMemberAction,
  type TeamActionState,
} from "@/lib/team/actions";
import { INVITABLE_ROLES, INVITABLE_ROLE_LABELS } from "@/validations/team";
import type { OrganizationRole } from "@/generated/prisma/enums";

const initialState: TeamActionState = { status: "idle" };

/**
 * Per-member actions.
 *
 * Every item posts to a Server Action; nothing here decides whether an action
 * is permitted. Items are hidden when they would obviously fail — the last
 * owner, or yourself — but that is only to avoid offering a dead end. The
 * server re-checks all of it, so a crafted request gets the same answer.
 */
export function MemberActions({
  membershipId,
  role,
  status,
  isSelf,
  isLastOwner,
}: {
  membershipId: string;
  role: OrganizationRole;
  status: "INVITED" | "ACTIVE" | "SUSPENDED" | "REMOVED";
  isSelf: boolean;
  isLastOwner: boolean;
}) {
  // One shared state per action so results can be surfaced as a toast.
  const [roleState, submitRole] = useActionState(changeRoleAction, initialState);
  const [suspendState, submitSuspend] = useActionState(
    suspendMemberAction,
    initialState,
  );
  const [reactivateState, submitReactivate] = useActionState(
    reactivateMemberAction,
    initialState,
  );
  const [removeState, submitRemove] = useActionState(
    removeMemberAction,
    initialState,
  );

  useToastOnResult(roleState);
  useToastOnResult(suspendState);
  useToastOnResult(reactivateState);
  useToastOnResult(removeState);

  const submit = (action: (data: FormData) => void, extra?: Record<string, string>) => {
    const data = new FormData();
    data.set("membershipId", membershipId);
    for (const [key, value] of Object.entries(extra ?? {})) data.set(key, value);
    action(data);
  };

  // Nothing can be done to the sole owner, and nothing destructive to yourself.
  const protectedOwner = role === "OWNER" && isLastOwner;
  const canChangeRole = !protectedOwner && !isSelf;
  const canSuspend = !protectedOwner && !isSelf && status === "ACTIVE";
  const canReactivate = status === "SUSPENDED";
  const canRemove = !protectedOwner && !isSelf && status !== "REMOVED";

  if (!canChangeRole && !canSuspend && !canReactivate && !canRemove) {
    return null;
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon" aria-label="Member actions">
          <MoreHorizontal className="size-4" aria-hidden="true" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-52">
        {canChangeRole ? (
          <>
            <DropdownMenuLabel className="type-caption font-medium">
              Change role
            </DropdownMenuLabel>
            {INVITABLE_ROLES.filter((option) => option !== role).map((option) => (
              <DropdownMenuItem
                key={option}
                onSelect={() => submit(submitRole, { role: option })}
              >
                <ShieldCheck className="size-4" aria-hidden="true" />
                Make {INVITABLE_ROLE_LABELS[option].toLowerCase()}
              </DropdownMenuItem>
            ))}
            <DropdownMenuSeparator />
          </>
        ) : null}

        {canSuspend ? (
          <DropdownMenuItem onSelect={() => submit(submitSuspend)}>
            <UserMinus className="size-4" aria-hidden="true" />
            Suspend access
          </DropdownMenuItem>
        ) : null}

        {canReactivate ? (
          <DropdownMenuItem onSelect={() => submit(submitReactivate)}>
            <UserRoundCheck className="size-4" aria-hidden="true" />
            Reactivate
          </DropdownMenuItem>
        ) : null}

        {canRemove ? (
          <DropdownMenuItem
            variant="destructive"
            onSelect={() => submit(submitRemove)}
          >
            <UserMinus className="size-4" aria-hidden="true" />
            Remove from practice
          </DropdownMenuItem>
        ) : null}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/** Surfaces an action result once, as a toast. */
function useToastOnResult(state: TeamActionState) {
  const seen = useRef<TeamActionState>(state);

  useEffect(() => {
    if (state === seen.current || state.status === "idle" || !state.message) return;
    seen.current = state;

    if (state.status === "error") toast.error(state.message);
    else toast.success(state.message);
  }, [state]);
}
