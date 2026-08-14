import type { Metadata } from "next";

import { ClientForm } from "@/components/clients/client-form";
import { StandardPage } from "@/components/templates/page-templates";
import { requireClientContext } from "@/lib/auth/dal";
import { createClientAction } from "@/lib/clients/actions";
import { listAssignableMembers, seesAllClients } from "@/services/clients";

export const metadata: Metadata = { title: "Add client" };

/**
 * Add a client.
 *
 * Every staff role may create clients — reception takes the details at the
 * front desk as often as a dietitian does. Assignment is offered only to those
 * who administer the practice; a dietitian creating a client leaves it
 * unassigned, and an owner assigns it afterwards.
 */
export default async function NewClientPage() {
  const { viewer } = await requireClientContext();

  const canAssign = seesAllClients(viewer.role);
  const members = canAssign
    ? await listAssignableMembers(viewer.organizationId)
    : [];

  return (
    <StandardPage
      title="Add client"
      description="Basic details now — assessments and plans come later."
      breadcrumbs={[
        { label: "Clients", href: "/clients" },
        { label: "Add client" },
      ]}
      className="max-w-3xl"
    >
      <ClientForm
        action={createClientAction}
        members={members}
        canAssign={canAssign}
        submitLabel="Create client"
        pendingLabel="Creating client…"
        cancelHref="/clients"
      />
    </StandardPage>
  );
}
