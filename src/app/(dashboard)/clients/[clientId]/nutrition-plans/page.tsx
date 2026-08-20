import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { CalendarRange } from "lucide-react";

import { CreatePlanForm } from "@/components/nutrition/create-plan-form";
import { EmptyState } from "@/components/shared/empty-state";
import { ListPage } from "@/components/templates/page-templates";
import { Button } from "@/components/ui/button";
import { requireClinicalContext } from "@/lib/auth/dal";
import { getClient } from "@/services/clients";
import { listPlans } from "@/services/nutrition/plans";

export const metadata: Metadata = { title: "Nutrition Plans" };

/**
 * A client's nutrition plans.
 *
 * Clinical by audience, so `requireClinicalContext()` gates it exactly as the
 * assessment screens do: a RECEPTIONIST manages the client record and is
 * refused here, by the service, and independently by RLS.
 */
export default async function NutritionPlansPage({
  params,
}: PageProps<"/clients/[clientId]/nutrition-plans">) {
  const { clientId } = await params;
  const { viewer } = await requireClinicalContext();

  const client = await getClient(viewer, clientId);
  if (!client) notFound();

  const plans = await listPlans(viewer.organizationId, clientId);
  const fullName = `${client.firstName} ${client.lastName}`;

  return (
    <ListPage
      title="Nutrition plans"
      description={`Planned days for ${fullName}, with automatic target comparison.`}
      breadcrumbs={[
        { label: "Clients", href: "/clients" },
        { label: fullName, href: `/clients/${clientId}` },
        { label: "Nutrition plans" },
      ]}
      toolbar={<CreatePlanForm clientId={clientId} />}
    >
      {plans.length === 0 ? (
        <EmptyState
          icon={CalendarRange}
          title="No plans yet"
          description="Create a plan for a day, add foods to its meals, and Vyom totals the nutrition and compares it against this client's targets as you go."
        />
      ) : (
        <div className="overflow-x-auto rounded-lg border">
          <table className="w-full text-left">
            <thead className="border-b bg-muted/40">
              <tr>
                <th scope="col" className="type-caption px-4 py-2 font-medium">
                  Plan
                </th>
                <th scope="col" className="type-caption px-4 py-2 font-medium">
                  Date
                </th>
                <th scope="col" className="type-caption px-4 py-2 text-right font-medium">
                  Foods
                </th>
                <th scope="col" className="px-4 py-2">
                  <span className="sr-only">Open</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {plans.map((plan) => (
                <tr key={plan.id} className="border-b last:border-0">
                  <td className="type-body px-4 py-2">
                    <Link
                      href={`/clients/${clientId}/nutrition-plans/${plan.id}`}
                      className="font-medium underline-offset-4 hover:underline focus-visible:underline"
                    >
                      {plan.name}
                    </Link>
                  </td>
                  <td className="type-body px-4 py-2">
                    {plan.planDate.toLocaleDateString("en-IN", {
                      day: "numeric",
                      month: "short",
                      year: "numeric",
                      timeZone: "UTC",
                    })}
                  </td>
                  <td className="type-body px-4 py-2 text-right tabular-nums">
                    {plan.itemCount}
                  </td>
                  <td className="px-4 py-2 text-right">
                    <Button asChild variant="outline" size="sm">
                      <Link href={`/clients/${clientId}/nutrition-plans/${plan.id}`}>
                        Open
                      </Link>
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </ListPage>
  );
}
