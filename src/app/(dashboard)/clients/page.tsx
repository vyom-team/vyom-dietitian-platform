import type { Metadata } from "next";
import { Filter, Search, UserPlus } from "lucide-react";

import { DataTable, type Column } from "@/components/shared/data-table";
import { StatusBadge, type StatusTone } from "@/components/shared/status-badge";
import { ListPage } from "@/components/templates/page-templates";
import { Button } from "@/components/ui/button";
import {
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
} from "@/components/ui/input-group";

export const metadata: Metadata = { title: "Clients" };

/**
 * DESIGN PREVIEW — NOT PRODUCTION DATA.
 *
 * Rows are placeholders that exist to show table density, alignment, and status
 * treatment. Names are obviously non-real, and no clinical values (weight,
 * calories, macros) appear — those must always come from real records and
 * reference data, never from a layout file.
 */
type DemoClient = {
  id: string;
  name: string;
  reference: string;
  planStatus: { label: string; tone: StatusTone };
  lastActivity: string;
};

const demoClients: DemoClient[] = [
  {
    id: "1",
    name: "Client A",
    reference: "VY-1001",
    planStatus: { label: "Active plan", tone: "success" },
    lastActivity: "Today",
  },
  {
    id: "2",
    name: "Client B",
    reference: "VY-1002",
    planStatus: { label: "Draft", tone: "neutral" },
    lastActivity: "Yesterday",
  },
  {
    id: "3",
    name: "Client C",
    reference: "VY-1003",
    planStatus: { label: "Review due", tone: "warning" },
    lastActivity: "3 days ago",
  },
  {
    id: "4",
    name: "Client D",
    reference: "VY-1004",
    planStatus: { label: "No plan", tone: "info" },
    lastActivity: "1 week ago",
  },
];

const columns: Column<DemoClient>[] = [
  {
    id: "name",
    header: "Client",
    cell: (row) => (
      <div className="min-w-0">
        <p className="font-medium">{row.name}</p>
        <p className="type-caption">{row.reference}</p>
      </div>
    ),
  },
  {
    id: "status",
    header: "Plan status",
    cell: (row) => (
      <StatusBadge tone={row.planStatus.tone}>{row.planStatus.label}</StatusBadge>
    ),
  },
  {
    id: "activity",
    header: "Last activity",
    hideOnMobile: true,
    cell: (row) => (
      <span className="text-muted-foreground">{row.lastActivity}</span>
    ),
  },
  {
    id: "actions",
    header: "",
    align: "end",
    width: "1%",
    cell: () => (
      <Button variant="ghost" size="sm" disabled>
        View
      </Button>
    ),
  },
];

export default function ClientsPage() {
  return (
    <ListPage
      title="Clients"
      description="Manage your clients and monitor their nutrition journey."
      action={
        <Button>
          <UserPlus className="size-4" aria-hidden="true" />
          Add client
        </Button>
      }
      toolbar={
        <>
          <InputGroup className="sm:max-w-xs">
            <InputGroupAddon>
              <Search className="size-4" aria-hidden="true" />
            </InputGroupAddon>
            <InputGroupInput
              placeholder="Search clients"
              aria-label="Search clients"
              disabled
            />
          </InputGroup>
          <Button variant="outline" disabled>
            <Filter className="size-4" aria-hidden="true" />
            Filters
          </Button>
        </>
      }
    >
      <DataTable
        columns={columns}
        rows={demoClients}
        getRowId={(row) => row.id}
        caption="Placeholder client list demonstrating table layout"
      />
      <p className="type-caption">
        Placeholder rows shown to demonstrate table layout. Client records arrive
        with the database.
      </p>
    </ListPage>
  );
}
