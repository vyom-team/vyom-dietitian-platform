import type { Metadata } from "next";
import Link from "next/link";
import { UserPlus, Users } from "lucide-react";

import { EmptyState } from "@/components/shared/empty-state";
import { ClientFilters } from "@/components/clients/client-filters";
import { ClientList } from "@/components/clients/client-list";
import { ClientPagination } from "@/components/clients/client-pagination";
import { ListPage } from "@/components/templates/page-templates";
import { Button } from "@/components/ui/button";
import { requireClientContext } from "@/lib/auth/dal";
import {
  listAssignableMembers,
  listClients,
  seesAllClients,
} from "@/services/clients";
import { clientListQuerySchema } from "@/validations/client";

export const metadata: Metadata = { title: "Clients" };

/**
 * Client list.
 *
 * Search, filtering, and pagination all happen in the database query. The
 * browser never receives a client the viewer is not entitled to see, so there
 * is nothing to hide client-side and nothing to leak in a network response.
 *
 * A dietitian's list is their own caseload; owners and receptionists see the
 * whole practice. That rule lives in `seesAllClients` and is applied as a
 * WHERE clause — see services/clients.ts.
 */
export default async function ClientsPage({
  searchParams,
}: PageProps<"/clients">) {
  const { viewer } = await requireClientContext();
  const params = await searchParams;

  // `.catch()` in the schema clamps nonsense values rather than erroring: a
  // hand-edited `?page=abc` should show page one, not a crash.
  const query = clientListQuerySchema.parse({
    q: params.q,
    status: params.status,
    assigned: params.assigned,
    page: params.page,
  });

  const showsWholePractice = seesAllClients(viewer.role);

  const [result, members] = await Promise.all([
    listClients(viewer, query),
    showsWholePractice
      ? listAssignableMembers(viewer.organizationId)
      : Promise.resolve([]),
  ]);

  const isFiltered = Boolean(query.q || query.assigned || query.status !== "active");
  const hasNoClientsAtAll = result.total === 0 && !isFiltered;

  return (
    <ListPage
      title="Clients"
      description={
        showsWholePractice
          ? "Everyone your practice looks after."
          : "The clients assigned to you."
      }
      action={
        <Button asChild>
          <Link href="/clients/new">
            <UserPlus className="size-4" aria-hidden="true" />
            Add client
          </Link>
        </Button>
      }
      toolbar={
        hasNoClientsAtAll ? undefined : (
          <ClientFilters
            members={members}
            canFilterByAssignee={showsWholePractice}
          />
        )
      }
    >
      {hasNoClientsAtAll ? (
        <EmptyState
          icon={Users}
          title="No clients yet"
          description={
            showsWholePractice
              ? "Start building your practice by adding your first client."
              : "Clients assigned to you will appear here."
          }
          action={
            <Button asChild>
              <Link href="/clients/new">
                <UserPlus className="size-4" aria-hidden="true" />
                Add client
              </Link>
            </Button>
          }
        />
      ) : result.clients.length === 0 ? (
        <EmptyState
          title="No clients match those filters"
          description="Try a different search term, or clear the filters to see everyone."
          action={
            <Button variant="outline" asChild>
              <Link href="/clients">Clear filters</Link>
            </Button>
          }
        />
      ) : (
        <div className="space-y-4">
          <ClientList clients={result.clients} />
          <ClientPagination
            page={result.page}
            pageCount={result.pageCount}
            total={result.total}
            searchParams={{
              q: query.q,
              status: query.status === "active" ? undefined : query.status,
              assigned: query.assigned,
            }}
          />
        </div>
      )}
    </ListPage>
  );
}
