import type { Metadata } from "next";
import { Building2, ShieldCheck, UserRound } from "lucide-react";

import { Section } from "@/components/shared/section";
import { StandardPage } from "@/components/templates/page-templates";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { requireMembership } from "@/lib/auth/dal";
import { ROLE_LABELS } from "@/lib/auth/roles";

export const metadata: Metadata = { title: "Overview" };

/**
 * Practice dashboard.
 *
 * A Phase 4 placeholder: it exists to confirm the practice was created and that
 * the signed-in user is its owner. Client lists, plans, and analytics belong to
 * later phases and are deliberately absent — a dashboard full of invented
 * numbers would be worse than an honest empty one.
 *
 * `requireMembership()` sends a user without a practice to onboarding, which is
 * the mirror of the guard on the onboarding page.
 */
export default async function DashboardPage() {
  const { user, membership } = await requireMembership();

  const firstName = user.fullName?.split(" ")[0] ?? "there";

  const facts = [
    {
      icon: Building2,
      label: "Practice",
      value: membership.organizationName,
    },
    {
      icon: UserRound,
      label: "Owner",
      value: user.fullName ?? user.email,
    },
    {
      icon: ShieldCheck,
      label: "Your role",
      value: ROLE_LABELS[membership.role],
    },
  ];

  return (
    <StandardPage
      title={`Welcome, ${firstName}`}
      description="Your practice is set up and ready."
    >
      <Section>
        <dl className="grid gap-4 sm:grid-cols-3">
          {facts.map((fact) => (
            <div key={fact.label} className="rounded-xl border bg-card p-5">
              <div className="flex items-center gap-2">
                <fact.icon
                  className="size-4 shrink-0 text-muted-foreground"
                  aria-hidden="true"
                />
                <dt className="type-caption font-medium tracking-wide uppercase">
                  {fact.label}
                </dt>
              </div>
              <dd className="type-h3 mt-3 break-words">{fact.value}</dd>
            </div>
          ))}
        </dl>
      </Section>

      <Alert>
        <ShieldCheck />
        <AlertTitle>What&apos;s next</AlertTitle>
        <AlertDescription>
          Client management, nutrition targets, and meal plans are built in the
          phases that follow. This screen confirms your practice exists and that
          you own it — nothing here is placeholder data.
        </AlertDescription>
      </Alert>
    </StandardPage>
  );
}
