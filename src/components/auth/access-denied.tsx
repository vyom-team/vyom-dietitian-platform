import Link from "next/link";
import { Building2, ShieldOff } from "lucide-react";

import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/shared/empty-state";

/**
 * Authenticated but not permitted.
 *
 * Deliberately *not* a redirect to sign-in: the user is already signed in, and
 * bouncing them to a login page they will immediately be redirected out of
 * creates a loop and reads as a bug. The honest answer is "no".
 *
 * The copy never says whether the resource exists, so this page cannot be used
 * to probe for valid organization ids.
 */
export function AccessDenied() {
  return (
    <EmptyState
      icon={ShieldOff}
      title="You don't have access to this"
      description="Your account doesn't have permission to view this area. If you think that's wrong, ask an owner of your practice to check your role."
      action={
        <Button variant="outline" asChild>
          <Link href="/dashboard">Back to overview</Link>
        </Button>
      }
    />
  );
}

/**
 * Authenticated, but belongs to no organization.
 *
 * A legitimate state rather than an error — it is what a brand-new account
 * looks like before onboarding exists. Organization creation is a later phase,
 * so this explains the situation without pretending to offer the flow.
 */
export function NoOrganization() {
  return (
    <EmptyState
      icon={Building2}
      title="No practice linked to your account"
      description="Your account isn't part of a practice yet. Creating and joining practices arrives in the next phase of the product."
    />
  );
}
