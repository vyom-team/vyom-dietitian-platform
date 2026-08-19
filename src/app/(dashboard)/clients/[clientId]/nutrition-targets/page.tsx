import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ClipboardList } from "lucide-react";

import { NutritionTargetsView } from "@/components/assessments/nutrition-targets-view";
import { EmptyState } from "@/components/shared/empty-state";
import { DetailPage } from "@/components/templates/page-templates";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { requireClinicalContext } from "@/lib/auth/dal";
import { getClient } from "@/services/clients";
import { getNutritionTargets } from "@/services/nutrition/targets";

export const metadata: Metadata = { title: "Nutrition Targets" };

/**
 * A client's nutrition targets.
 *
 * AUTHORIZATION
 *
 * `requireClinicalContext()` — the same clinical boundary as the assessment
 * screens. A RECEPTIONIST manages client records but has no clinical reason to
 * see requirement figures derived from health data, and is refused here, by the
 * service, and independently by RLS.
 *
 * The organization id comes from that call and from nowhere else. `getClient`
 * is then scoped by organization *and* the viewer's visibility, so a client id
 * belonging to another practice renders as not-found — identical to an id that
 * does not exist, so this route cannot be used to probe for real ones.
 *
 * NOTHING IS CALCULATED HERE
 *
 * The page reads, the service computes, the component renders. No clinical
 * arithmetic lives in this file or any component it renders.
 *
 * AUTOMATION
 *
 * There is deliberately no "Calculate" button. The targets are a pure function
 * of an assessment that already exists, so making a dietitian press a button to
 * see them would be ceremony — the page simply shows them. That is the product
 * intent: Vyom did the calculation, rather than Vyom gave you a calculator.
 */
export default async function NutritionTargetsPage({
  params,
}: PageProps<"/clients/[clientId]/nutrition-targets">) {
  const { clientId } = await params;
  const { viewer } = await requireClinicalContext();

  const client = await getClient(viewer, clientId);
  if (!client) notFound();

  const result = await getNutritionTargets(viewer.organizationId, clientId);

  const fullName = `${client.firstName} ${client.lastName}`;

  return (
    <DetailPage
      title="Nutrition targets"
      description={`Reference-derived daily requirements for ${fullName}.`}
      breadcrumbs={[
        { label: "Clients", href: "/clients" },
        { label: fullName, href: `/clients/${clientId}` },
        { label: "Nutrition targets" },
      ]}
      action={
        <Button asChild variant="outline">
          <Link href={`/clients/${clientId}`}>Back to client</Link>
        </Button>
      }
    >
      {result.ok ? (
        <>
          <p className="type-caption">
            Calculated from the assessment of{" "}
            {result.assessment.assessmentDate.toLocaleDateString("en-IN", {
              day: "numeric",
              month: "long",
              year: "numeric",
              timeZone: "UTC",
            })}
            .
          </p>

          <NutritionTargetsView profile={result.data} />
        </>
      ) : result.reason === "no-assessment" ? (
        <EmptyState
          icon={ClipboardList}
          title="No completed assessment"
          description="Targets are derived from a completed nutrition assessment. Complete one for this client and they will appear here — height and weight are the minimum needed."
          action={
            <Button asChild>
              <Link href={`/clients/${clientId}/assessments/new`}>
                New assessment
              </Link>
            </Button>
          }
        />
      ) : result.reason === "client-not-found" ? (
        notFound()
      ) : (
        <Alert variant="destructive">
          <AlertTitle>Targets could not be calculated</AlertTitle>
          <AlertDescription>
            Something went wrong reading this client&apos;s assessment. Try again,
            and if it persists the assessment may need to be re-saved.
          </AlertDescription>
        </Alert>
      )}
    </DetailPage>
  );
}
