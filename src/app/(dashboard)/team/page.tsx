import type { Metadata } from "next";
import { Users } from "lucide-react";

import { EmptyState } from "@/components/shared/empty-state";
import { Section } from "@/components/shared/section";
import { InviteDialog } from "@/components/team/invite-dialog";
import { MemberList } from "@/components/team/member-list";
import { PendingInvitations } from "@/components/team/pending-invitations";
import { StandardPage } from "@/components/templates/page-templates";
import { requireMembership } from "@/lib/auth/dal";
import { ORGANIZATION_ADMIN_ROLES, hasRole } from "@/lib/auth/roles";
import { listPendingInvitations, listTeamMembers } from "@/services/team";

export const metadata: Metadata = { title: "Team" };

/**
 * Team management.
 *
 * Visible to every member so people can see who they work with; management
 * actions are restricted to owners. The `canManage` flag only controls what is
 * *rendered* — every action re-checks permission on the server, so hiding a
 * button is a courtesy rather than the control.
 *
 * Pending invitations are fetched only for admins: the list reveals hiring
 * plans and email addresses, which a receptionist has no need for. That
 * restriction is enforced by the RLS policy as well as here.
 */
export default async function TeamPage() {
  const { user, membership } = await requireMembership();

  const canManage = hasRole(membership.role, ORGANIZATION_ADMIN_ROLES);

  const [members, invitations] = await Promise.all([
    listTeamMembers(membership.organizationId),
    canManage ? listPendingInvitations(membership.organizationId) : Promise.resolve([]),
  ]);

  const activeCount = members.filter((m) => m.status === "ACTIVE").length;
  const onlyOwner = members.length === 1 && invitations.length === 0;

  return (
    <StandardPage
      title="Team"
      description={`Manage who works in ${membership.organizationName}.`}
      action={canManage ? <InviteDialog /> : undefined}
    >
      {onlyOwner && canManage ? (
        <EmptyState
          icon={Users}
          title="Your practice is ready"
          description="Invite your dietitians and reception staff so you can work together on client care."
          action={<InviteDialog />}
        />
      ) : (
        <Section
          title="Team members"
          description={`${activeCount} active ${activeCount === 1 ? "member" : "members"}.`}
        >
          <MemberList
            members={members}
            currentUserId={user.profileId}
            canManage={canManage}
          />
        </Section>
      )}

      {canManage ? <PendingInvitations invitations={invitations} /> : null}
    </StandardPage>
  );
}
