"use client";

import { AlertTriangle, RotateCw } from "lucide-react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

type ErrorStateProps = {
  title?: string;
  description?: string;
  onRetry?: () => void;
  variant?: "card" | "plain";
  className?: string;
};

/**
 * Error presentation for a failed section or page.
 *
 * Deliberately shows no technical detail — stack traces and error codes go to
 * logs, not to practitioners. Keep the tone calm and the next step obvious.
 */
export function ErrorState({
  title = "Something went wrong",
  description = "We couldn't load this section. Please try again.",
  onRetry,
  variant = "card",
  className,
}: ErrorStateProps) {
  return (
    <div
      role="alert"
      className={cn(
        "flex flex-col items-center justify-center px-6 py-12 text-center",
        variant === "card" && "rounded-xl border bg-card",
        className,
      )}
    >
      <div className="mb-4 flex size-10 items-center justify-center rounded-lg bg-destructive-subtle text-destructive">
        <AlertTriangle className="size-5" aria-hidden="true" />
      </div>
      <p className="type-h4">{title}</p>
      <p className="type-body mt-1.5 max-w-sm text-pretty text-muted-foreground">
        {description}
      </p>
      {onRetry ? (
        <Button variant="outline" className="mt-5" onClick={onRetry}>
          <RotateCw className="size-4" aria-hidden="true" />
          Try again
        </Button>
      ) : null}
    </div>
  );
}
