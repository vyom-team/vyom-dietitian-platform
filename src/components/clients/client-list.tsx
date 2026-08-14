import Link from "next/link";
import { ChevronRight } from "lucide-react";

import { StatusBadge } from "@/components/shared/status-badge";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import type { ClientListItem } from "@/services/clients";

/**
 * Client roster.
 *
 * Each row is a single link rather than a table row with a nested action, so
 * the whole row is one keyboard stop and one tap target. Below `sm` the
 * secondary columns stack underneath the name instead of scrolling sideways.
 */
export function ClientList({ clients }: { clients: ClientListItem[] }) {
  return (
    <ul className="divide-y overflow-hidden rounded-xl border bg-card">
      {clients.map((client) => {
        const name = `${client.firstName} ${client.lastName}`;

        return (
          <li key={client.id}>
            <Link
              href={`/clients/${client.id}`}
              className="flex items-center gap-4 p-4 outline-none transition-colors hover:bg-muted/40 focus-visible:bg-muted/40 focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:ring-inset"
            >
              <Avatar className="size-9 shrink-0">
                <AvatarFallback className="text-xs">
                  {initials(client.firstName, client.lastName)}
                </AvatarFallback>
              </Avatar>

              <div className="min-w-0 flex-1 space-y-0.5">
                <p className="type-body font-medium break-words">{name}</p>
                <p className="type-caption">
                  <span className="font-mono">{client.clientNumber}</span>
                  {client.email ? (
                    <span className="hidden sm:inline"> · {client.email}</span>
                  ) : null}
                </p>
                {/* Stacked on mobile, where the dedicated columns are hidden. */}
                <p className="type-caption sm:hidden">
                  {client.assignedName ?? "Unassigned"}
                </p>
              </div>

              <span className="type-body-sm hidden w-40 shrink-0 truncate text-muted-foreground sm:block">
                {client.assignedName ?? (
                  <span className="text-muted-foreground/70">Unassigned</span>
                )}
              </span>

              <span className="hidden shrink-0 md:block">
                {client.status === "ACTIVE" ? (
                  <StatusBadge tone="success">Active</StatusBadge>
                ) : (
                  <StatusBadge tone="neutral">Archived</StatusBadge>
                )}
              </span>

              <span className="type-caption hidden w-24 shrink-0 lg:block">
                {formatDate(client.createdAt)}
              </span>

              <ChevronRight
                className="size-4 shrink-0 text-muted-foreground"
                aria-hidden="true"
              />
            </Link>
          </li>
        );
      })}
    </ul>
  );
}

function initials(first: string, last: string): string {
  return `${first[0] ?? ""}${last[0] ?? ""}`.toUpperCase() || "?";
}

function formatDate(date: Date): string {
  return new Date(date).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}
