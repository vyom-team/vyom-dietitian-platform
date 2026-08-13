import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { StatusBadge, type StatusTone } from "@/components/shared/status-badge";
import { MemberActions } from "@/components/team/member-actions";
import { ROLE_LABELS } from "@/lib/auth/roles";
import type { TeamMember } from "@/services/team";

const STATUS_TONE: Record<TeamMember["status"], StatusTone> = {
  ACTIVE: "success",
  INVITED: "info",
  SUSPENDED: "warning",
  REMOVED: "neutral",
};

const STATUS_LABEL: Record<TeamMember["status"], string> = {
  ACTIVE: "Active",
  INVITED: "Invited",
  SUSPENDED: "Suspended",
  REMOVED: "Removed",
};

/**
 * Team roster.
 *
 * One responsive layout rather than a desktop table plus a mobile card list:
 * each row is a flex container that stacks below `sm`, so there is a single
 * markup path to keep correct and no horizontal scrolling on a phone.
 */
export function MemberList({
  members,
  currentUserId,
  canManage,
}: {
  members: TeamMember[];
  currentUserId: string;
  canManage: boolean;
}) {
  const activeOwners = members.filter(
    (member) => member.role === "OWNER" && member.status === "ACTIVE",
  ).length;

  return (
    <ul className="divide-y overflow-hidden rounded-xl border bg-card">
      {members.map((member) => {
        const isSelf = member.userId === currentUserId;
        const displayName = member.name ?? member.email;

        return (
          <li
            key={member.membershipId}
            className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:gap-4"
          >
            <Avatar className="size-9 shrink-0">
              <AvatarFallback className="text-xs">
                {initials(displayName)}
              </AvatarFallback>
            </Avatar>

            <div className="min-w-0 flex-1 space-y-0.5">
              <p className="type-body font-medium break-words">
                {displayName}
                {isSelf ? (
                  <span className="type-caption ml-2 font-normal">You</span>
                ) : null}
              </p>
              <p className="type-caption break-words">{member.email}</p>
              {member.professionalTitle ? (
                <p className="type-caption">{member.professionalTitle}</p>
              ) : null}
            </div>

            <div className="flex items-center gap-3 sm:gap-4">
              <span className="type-body-sm text-muted-foreground">
                {ROLE_LABELS[member.role]}
              </span>

              <StatusBadge tone={STATUS_TONE[member.status]}>
                {STATUS_LABEL[member.status]}
              </StatusBadge>

              <span className="type-caption hidden w-24 shrink-0 lg:inline">
                {member.joinedAt ? formatDate(member.joinedAt) : "—"}
              </span>

              {canManage ? (
                <MemberActions
                  membershipId={member.membershipId}
                  role={member.role}
                  status={member.status}
                  isSelf={isSelf}
                  isLastOwner={activeOwners <= 1}
                />
              ) : (
                // Keeps rows aligned when the actions column is absent.
                <span className="size-8 shrink-0" aria-hidden="true" />
              )}
            </div>
          </li>
        );
      })}
    </ul>
  );
}

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).slice(0, 2);
  const letters = parts.map((part) => part[0] ?? "").join("");
  return (letters || name.slice(0, 2)).toUpperCase();
}

function formatDate(date: Date): string {
  return new Date(date).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}
