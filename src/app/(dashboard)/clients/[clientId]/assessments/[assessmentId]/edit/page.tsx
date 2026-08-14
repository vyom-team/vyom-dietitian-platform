import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { AssessmentForm } from "@/components/assessments/assessment-form";
import { StandardPage } from "@/components/templates/page-templates";
import { requireClinicalContext } from "@/lib/auth/dal";
import { updateAssessmentAction } from "@/lib/assessments/actions";
import { getAssessment } from "@/services/assessments";
import { ASSESSMENT_TYPE_LABELS } from "@/validations/assessment";

export const metadata: Metadata = { title: "Edit assessment" };

/**
 * Continue a draft, or correct a completed assessment.
 *
 * Editing changes *this* record. A follow-up consultation creates a new
 * assessment instead — overwriting the previous one would destroy the trend
 * that makes this data worth keeping.
 */
export default async function EditAssessmentPage({
  params,
}: PageProps<"/clients/[clientId]/assessments/[assessmentId]/edit">) {
  const { clientId, assessmentId } = await params;
  const { viewer } = await requireClinicalContext();

  const assessment = await getAssessment(viewer, assessmentId);
  // Also guards against a mismatched client id in the URL.
  if (!assessment || assessment.clientId !== clientId) notFound();

  const name = `${assessment.clientFirstName} ${assessment.clientLastName}`;
  const isDraft = assessment.status === "DRAFT";

  return (
    <StandardPage
      title={isDraft ? "Continue assessment" : "Edit assessment"}
      description={`${ASSESSMENT_TYPE_LABELS[assessment.assessmentType]} for ${name}.`}
      breadcrumbs={[
        { label: "Clients", href: "/clients" },
        { label: name, href: `/clients/${assessment.clientId}` },
        { label: isDraft ? "Continue" : "Edit" },
      ]}
      className="max-w-3xl"
    >
      <AssessmentForm
        action={updateAssessmentAction}
        clientId={assessment.clientId}
        clientName={name}
        assessment={assessment}
        cancelHref={`/clients/${assessment.clientId}`}
      />
    </StandardPage>
  );
}
