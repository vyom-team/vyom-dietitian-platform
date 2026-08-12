import { StatCardSkeleton } from "@/components/shared/stat-card";
import { Skeleton } from "@/components/ui/skeleton";

/**
 * Route-level loading UI.
 *
 * Skeletons mirror the real layout rather than showing a full-screen spinner,
 * so the page does not visibly jump when content arrives.
 */
export default function DashboardLoading() {
  return (
    <div className="space-y-8" aria-busy="true">
      <div className="space-y-2">
        <Skeleton className="h-8 w-52" />
        <Skeleton className="h-4 w-80" />
      </div>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {Array.from({ length: 4 }).map((_, index) => (
          <StatCardSkeleton key={index} />
        ))}
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        <Skeleton className="h-64 lg:col-span-2" />
        <Skeleton className="h-64" />
      </div>

      <span className="sr-only">Loading page</span>
    </div>
  );
}
