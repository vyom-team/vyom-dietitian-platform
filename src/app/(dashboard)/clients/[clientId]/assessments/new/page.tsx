import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { AssessmentForm } from "@/components/assessments/assessment-form";
import { StandardPage } from "@/components/templates/page-templates";
import { requireClinicalContext } from "@/lib/auth/dal";
import { createAssessmentAction } from "@/lib/assessments/actions";
import { getClient } from "@/services/clients";

export const metadata: Metadata = { title: "New assessment" };

/**
 * Start a nutrition assessment.
 *
 * `requireClinicalContext()` refuses RECEPTIONIST and CLIENT roles before
 * anything renders. The client is then loaded through the Phase 6 scoped
 * lookup, so a dietitian cannot open a form against a client outside their
 * caseload, and nobody can against another practice's client.
 */
export default async function NewAssessmentPage({
  params,
}: PageProps<"/clients/[clientId]/assessments/new">) {
  const { clientId } = await params;
  const { viewer } = await requireClinicalContext();

  const client = await getClient(viewer, clientId);
  if (!client) notFound();

  const name = `${client.firstName} ${client.lastName}`;

  return (
    <StandardPage
      title="New nutrition assessment"
      description={`Recording an assessment for ${name}.`}
      breadcrumbs={[
        { label: "Clients", href: "/clients" },
        { label: name, href: `/clients/${client.id}` },
        { label: "New assessment" },
      ]}
      className="max-w-3xl"
    >
      <AssessmentForm
        action={createAssessmentAction}
        clientId={client.id}
        clientName={name}
        cancelHref={`/clients/${client.id}`}
      />
    </StandardPage>
  );
}
