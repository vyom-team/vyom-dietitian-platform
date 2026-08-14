import Link from "next/link";
import { ChevronLeft, ChevronRight } from "lucide-react";

import { Button } from "@/components/ui/button";

/**
 * Pagination for the client list.
 *
 * Real links rather than buttons, so a page is bookmarkable and opens in a new
 * tab as expected. Page numbers only affect `skip`; the query they page through
 * is already organization- and role-scoped, so no page can reach another
 * practice's clients.
 */
export function ClientPagination({
  page,
  pageCount,
  total,
  searchParams,
}: {
  page: number;
  pageCount: number;
  total: number;
  searchParams: Record<string, string | undefined>;
}) {
  if (pageCount <= 1) return null;

  const href = (targetPage: number) => {
    const params = new URLSearchParams();
    for (const [key, value] of Object.entries(searchParams)) {
      if (value && key !== "page") params.set(key, value);
    }
    if (targetPage > 1) params.set("page", String(targetPage));
    return params.size ? `/clients?${params}` : "/clients";
  };

  return (
    <nav
      className="flex items-center justify-between gap-4"
      aria-label="Client list pages"
    >
      <p className="type-caption">
        Page {page} of {pageCount} · {total} {total === 1 ? "client" : "clients"}
      </p>

      <div className="flex items-center gap-2">
        <Button
          variant="outline"
          size="sm"
          asChild={page > 1}
          disabled={page <= 1}
          aria-disabled={page <= 1}
        >
          {page > 1 ? (
            <Link href={href(page - 1)} rel="prev">
              <ChevronLeft className="size-4" aria-hidden="true" />
              Previous
            </Link>
          ) : (
            <span>
              <ChevronLeft className="size-4" aria-hidden="true" />
              Previous
            </span>
          )}
        </Button>

        <Button
          variant="outline"
          size="sm"
          asChild={page < pageCount}
          disabled={page >= pageCount}
          aria-disabled={page >= pageCount}
        >
          {page < pageCount ? (
            <Link href={href(page + 1)} rel="next">
              Next
              <ChevronRight className="size-4" aria-hidden="true" />
            </Link>
          ) : (
            <span>
              Next
              <ChevronRight className="size-4" aria-hidden="true" />
            </span>
          )}
        </Button>
      </div>
    </nav>
  );
}
