import type { Metadata } from "next";

import { OnboardingWizard } from "@/components/onboarding/onboarding-wizard";
import { requireOnboardingAccess } from "@/lib/auth/dal";

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

  return (
    <OnboardingWizard defaultFullName={user.fullName ?? ""} />
  );
}
