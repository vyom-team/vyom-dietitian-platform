import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { ClientForm } from "@/components/clients/client-form";
import { StandardPage } from "@/components/templates/page-templates";
import { requireClientContext } from "@/lib/auth/dal";
import { updateClientAction } from "@/lib/clients/actions";
import { getClient } from "@/services/clients";

export const metadata: Metadata = { title: "Edit client" };

/**
 * Edit a client's details.
 *
 * `getClient` is scoped by organization *and* by the viewer's visibility, so a
 * client from another practice — or one a dietitian is not assigned to —
 * returns null and renders as not-found. The response is identical to a client
 * that does not exist, so this route cannot be used to discover valid ids.
 */
export default async function EditClientPage({
  params,
}: PageProps<"/clients/[clientId]/edit">) {
  const { clientId } = await params;
  const { viewer } = await requireClientContext();

  const client = await getClient(viewer, clientId);
  if (!client) notFound();

  const name = `${client.firstName} ${client.lastName}`;

  return (
    <StandardPage
      title="Edit client"
      description={`Updating ${name}.`}
      breadcrumbs={[
        { label: "Clients", href: "/clients" },
        { label: name, href: `/clients/${client.id}` },
        { label: "Edit" },
      ]}
      className="max-w-3xl"
    >
      <ClientForm
        action={updateClientAction}
        client={client}
        submitLabel="Save changes"
        pendingLabel="Saving…"
        cancelHref={`/clients/${client.id}`}
      />
    </StandardPage>
  );
}
