import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ClipboardList, Pencil } from "lucide-react";

import {
  ArchiveClientButton,
  AssignClientDialog,
  RestoreClientButton,
} from "@/components/clients/client-actions";
import { AssessmentHistory } from "@/components/assessments/assessment-history";
import { Breadcrumbs } from "@/components/shared/breadcrumbs";
import { PageHeader } from "@/components/shared/page-header";
import { Section } from "@/components/shared/section";
import { StatusBadge } from "@/components/shared/status-badge";
import { Button } from "@/components/ui/button";
import { canAccessClinicalData, requireClientContext } from "@/lib/auth/dal";
import { CLIENT_GENDER_LABELS } from "@/validations/client";
import { getCountryLabel } from "@/lib/locale";
import {
  getClient,
  listAssignableMembers,
  seesAllClients,
} from "@/services/clients";
import { listAssessments } from "@/services/assessments";

export const metadata: Metadata = { title: "Client" };

/**
 * Client profile.
 *
 * `getClient` is scoped by organization *and* the viewer's visibility, so a
 * client belonging to another practice — or one a dietitian is not assigned to
 * — returns null and renders as not-found. Crucially the response is identical
 * to a genuinely nonexistent client, so this route cannot be used to discover
 * which ids exist elsewhere.
 *
 * The Nutrition section is clinical and is rendered only for clinical roles.
 * Meal plans and progress tracking have no section here because those modules
 * do not exist — an empty tab promising them would misrepresent the product.
 */
export default async function ClientProfilePage({
  params,
}: PageProps<"/clients/[clientId]">) {
  const { clientId } = await params;
  const { viewer } = await requireClientContext();

  const client = await getClient(viewer, clientId);
  if (!client) notFound();

  const canManage = seesAllClients(viewer.role) && viewer.role !== "RECEPTIONIST";

  /*
   * The nutrition section is clinical, so a RECEPTIONIST does not see it at
   * all — and would be refused by `requireClinicalContext` and by RLS if they
   * navigated to the URL directly. Only fetched when it will be rendered, so a
   * receptionist's page load carries no health data.
   */
  const canSeeClinical = canAccessClinicalData(viewer.role);

  const [members, assessments] = await Promise.all([
    canManage ? listAssignableMembers(viewer.organizationId) : Promise.resolve([]),
    canSeeClinical
      ? listAssessments(viewer, clientId, 5)
      : Promise.resolve([]),
  ]);

  const name = `${client.firstName} ${client.lastName}`;
  const isArchived = client.status === "ARCHIVED";

  const address = [
    client.addressLine,
    client.city,
    client.state,
    client.postalCode,
    client.country ? getCountryLabel(client.country) : undefined,
  ].filter(Boolean);

  return (
    <div className="space-y-8">
      <PageHeader
        title={name}
        breadcrumb={
          <Breadcrumbs
            items={[{ label: "Clients", href: "/clients" }, { label: name }]}
          />
        }
        description={client.clientNumber}
        secondaryActions={
          <>
            {isArchived ? (
              <StatusBadge tone="neutral">Archived</StatusBadge>
            ) : (
              <StatusBadge tone="success">Active</StatusBadge>
            )}
          </>
        }
        action={
          <div className="flex items-center gap-2">
            {!isArchived ? (
              <Button variant="outline" asChild>
                <Link href={`/clients/${client.id}/edit`}>
                  <Pencil className="size-4" aria-hidden="true" />
                  Edit
                </Link>
              </Button>
            ) : null}
            {canManage ? (
              isArchived ? (
                <RestoreClientButton clientId={client.id} />
              ) : (
                <ArchiveClientButton clientId={client.id} clientName={name} />
              )
            ) : null}
          </div>
        }
      />

      {isArchived ? (
        <div
          role="status"
          className="rounded-lg border border-warning/25 bg-warning-subtle p-4"
        >
          <p className="type-body-sm text-warning">
            This client is archived and hidden from the active list. Restore them
            to make changes.
          </p>
        </div>
      ) : null}

      <div className="grid gap-6 lg:grid-cols-3">
        <Section title="Contact" className="lg:col-span-2">
          <dl className="divide-y rounded-xl border bg-card px-5">
            <Row label="Email" value={client.email ?? undefined} />
            <Row label="Phone" value={client.phone ?? undefined} />
            <Row
              label="Date of birth"
              value={
                client.dateOfBirth
                  ? formatDate(client.dateOfBirth)
                  : undefined
              }
            />
            <Row
              label="Gender"
              value={client.gender ? CLIENT_GENDER_LABELS[client.gender] : undefined}
            />
            <Row
              label="Address"
              value={address.length ? address.join(", ") : undefined}
            />
          </dl>
        </Section>

        <Section
          title="Practice"
          action={
            canManage ? (
              <AssignClientDialog
                clientId={client.id}
                currentMemberId={client.assignedMemberId}
                members={members}
              />
            ) : undefined
          }
        >
          <dl className="divide-y rounded-xl border bg-card px-5">
            <Row
              label="Assigned to"
              value={client.assignedName ?? undefined}
              fallback="Unassigned"
            />
            <Row label="Client ID" value={client.clientNumber} mono />
            <Row label="Added" value={formatDate(client.createdAt)} />
            <Row label="Added by" value={client.createdByName ?? undefined} />
            {client.archivedAt ? (
              <Row label="Archived" value={formatDate(client.archivedAt)} />
            ) : null}
          </dl>
        </Section>
      </div>

      {canSeeClinical ? (
        <Section
          title="Nutrition"
          description="Assessments recorded for this client, newest first."
          action={
            assessments.length > 0 ? (
              <Button variant="outline" size="sm" asChild>
                <Link href={`/clients/${client.id}/assessments/new`}>
                  <ClipboardList className="size-4" aria-hidden="true" />
                  New assessment
                </Link>
              </Button>
            ) : undefined
          }
        >
          <AssessmentHistory assessments={assessments} clientId={client.id} />
        </Section>
      ) : null}
    </div>
  );
}

function Row({
  label,
  value,
  fallback = "—",
  mono,
}: {
  label: string;
  value?: string;
  fallback?: string;
  mono?: boolean;
}) {
  return (
    <div className="grid gap-0.5 py-3 sm:grid-cols-3 sm:gap-4">
      <dt className="type-caption sm:pt-0.5">{label}</dt>
      <dd
        className={`type-body break-words sm:col-span-2 ${
          value ? "" : "text-muted-foreground"
        } ${mono ? "font-mono" : ""}`}
      >
        {value ?? fallback}
      </dd>
    </div>
  );
}

function formatDate(date: Date): string {
  return new Date(date).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "long",
    year: "numeric",
  });
}
