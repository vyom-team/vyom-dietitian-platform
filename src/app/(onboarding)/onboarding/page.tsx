import type { Metadata } from "next";
import { MailCheck } from "lucide-react";

import { OnboardingWizard } from "@/components/onboarding/onboarding-wizard";
import { requireOnboardingAccess } from "@/lib/auth/dal";
import { ROLE_LABELS } from "@/lib/auth/roles";
import { findLiveInvitationsForEmail } from "@/services/team";

export const metadata: Metadata = { title: "Set up your practice" };

/**
 * Practice onboarding.
 *
 * `requireOnboardingAccess()` is the gate and it runs on the server before
 * anything renders:
 *
 *   no session          → redirected to sign-in
 *   already has a practice → redirected to the dashboard
 *   signed in, no practice → this page
 *
 * Because the decision happens before the first byte, there is no flash of
 * onboarding for a user who already has a practice.
 */
export default async function OnboardingPage() {
  const user = await requireOnboardingAccess();

  // Someone invited to an existing practice would otherwise be led straight
  // into creating their own — and end up owning an empty practice they never
  // meant to make. Surfacing the invitation first avoids that.
  const invitations = await findLiveInvitationsForEmail(user.email);

  return (
    <>
      {invitations.length > 0 ? (
        <div
          className="mt-4 flex items-start gap-3 rounded-xl border border-info/20 bg-info-subtle p-4"
          role="status"
        >
          <MailCheck className="mt-0.5 size-4 shrink-0 text-info" aria-hidden="true" />
          <div className="space-y-1">
            <p className="type-body-sm font-medium text-info">
              {invitations.length === 1
                ? "You have a pending invitation"
                : "You have pending invitations"}
            </p>
            <p className="type-body-sm text-info">
              {invitations
                .map(
                  (invitation) =>
                    `${invitation.organizationName} (${ROLE_LABELS[invitation.role].toLowerCase()})`,
                )
                .join(", ")}
              . Open the invitation link from your email to join instead of
              creating a new practice below.
            </p>
          </div>
        </div>
      ) : null}

      <OnboardingWizard defaultFullName={user.fullName ?? ""} />
    </>
  );
}
