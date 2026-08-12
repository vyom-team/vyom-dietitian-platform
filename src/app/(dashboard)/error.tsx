"use client";

import { useEffect } from "react";

import { ErrorState } from "@/components/shared/error-state";

/**
 * Route-level error boundary.
 *
 * The user sees calm, non-technical copy; the underlying error goes to the
 * console for now and to a logging service once one exists. Error details are
 * never rendered — they can contain client health data.
 */
export default function DashboardError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <div className="py-10">
      <ErrorState
        description="We couldn't load this section. Please try again — if it keeps happening, contact support."
        onRetry={reset}
      />
    </div>
  );
}
