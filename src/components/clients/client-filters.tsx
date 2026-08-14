"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useState, useTransition } from "react";
import { Search, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
} from "@/components/ui/input-group";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { AssignableMember } from "@/services/clients";
import { cn } from "@/lib/utils";

/**
 * Search and filters for the client list.
 *
 * State lives in the URL, not in React. That makes a filtered list linkable and
 * survivable across a refresh, and it means the *server* does the filtering —
 * the browser never receives clients the viewer then hides.
 */
export function ClientFilters({
  members,
  canFilterByAssignee,
}: {
  members: AssignableMember[];
  /** Hidden for dietitians, whose list is already just their own caseload. */
  canFilterByAssignee: boolean;
}) {
  const router = useRouter();
  const params = useSearchParams();
  const [isPending, startTransition] = useTransition();

  const currentQuery = params.get("q") ?? "";
  const currentStatus = params.get("status") ?? "active";
  const currentAssigned = params.get("assigned") ?? "all";

  const [term, setTerm] = useState(currentQuery);

  const push = (next: Record<string, string | undefined>) => {
    const search = new URLSearchParams(params.toString());

    for (const [key, value] of Object.entries(next)) {
      if (!value || value === "all" || (key === "status" && value === "active")) {
        search.delete(key);
      } else {
        search.set(key, value);
      }
    }
    // Any filter change invalidates the current page number.
    search.delete("page");

    startTransition(() => {
      router.push(search.size ? `/clients?${search}` : "/clients");
    });
  };

  /*
   * Debounced search. Without this, every keystroke is a server round trip;
   * 300ms is long enough to batch typing and short enough to feel immediate.
   */
  useEffect(() => {
    if (term === currentQuery) return;

    const timer = setTimeout(() => push({ q: term || undefined }), 300);
    return () => clearTimeout(timer);
    // `push` and `currentQuery` are derived from params, which changing would
    // re-trigger the effect and fight the debounce.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [term]);

  const statuses = [
    { value: "active", label: "Active" },
    { value: "archived", label: "Archived" },
    { value: "all", label: "All" },
  ];

  return (
    <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
      <div className="flex flex-1 flex-col gap-3 sm:flex-row sm:items-center">
        <InputGroup className="sm:max-w-xs">
          <InputGroupAddon>
            <Search className="size-4" aria-hidden="true" />
          </InputGroupAddon>
          <InputGroupInput
            value={term}
            onChange={(event) => setTerm(event.target.value)}
            placeholder="Search name, ID, email, phone"
            aria-label="Search clients"
          />
          {term ? (
            <InputGroupAddon align="inline-end">
              <button
                type="button"
                onClick={() => setTerm("")}
                aria-label="Clear search"
                className="rounded-sm outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
              >
                <X className="size-4 text-muted-foreground" aria-hidden="true" />
              </button>
            </InputGroupAddon>
          ) : null}
        </InputGroup>

        {canFilterByAssignee ? (
          <Select
            value={currentAssigned}
            onValueChange={(value) => push({ assigned: value })}
          >
            <SelectTrigger className="sm:w-52" aria-label="Filter by dietitian">
              <SelectValue placeholder="All dietitians" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All dietitians</SelectItem>
              <SelectItem value="unassigned">Unassigned</SelectItem>
              {members.map((member) => (
                <SelectItem key={member.membershipId} value={member.membershipId}>
                  {member.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        ) : null}
      </div>

      <div
        className={cn(
          "flex items-center gap-1 rounded-lg border p-1 transition-opacity",
          isPending && "opacity-60",
        )}
        role="group"
        aria-label="Filter by status"
      >
        {statuses.map((status) => (
          <Button
            key={status.value}
            type="button"
            variant={currentStatus === status.value ? "secondary" : "ghost"}
            size="sm"
            aria-pressed={currentStatus === status.value}
            onClick={() => push({ status: status.value })}
          >
            {status.label}
          </Button>
        ))}
      </div>
    </div>
  );
}
