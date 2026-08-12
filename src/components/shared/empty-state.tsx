import type { LucideIcon } from "lucide-react";

import { cn } from "@/lib/utils";

type EmptyStateProps = {
  icon?: LucideIcon;
  title: string;
  description?: string;
  action?: React.ReactNode;
  /** `card` sits inside a bordered surface; `plain` fills an existing one. */
  variant?: "card" | "plain";
  className?: string;
};

/**
 * Empty state.
 *
 * Copy should tell the practitioner what this area is for and what to do next —
 * "No clients yet", not "No data found".
 */
export function EmptyState({
  icon: Icon,
  title,
  description,
  action,
  variant = "card",
  className,
}: EmptyStateProps) {
  return (
    <div
      className={cn(
        "flex flex-col items-center justify-center px-6 py-12 text-center",
        variant === "card" && "rounded-xl border border-dashed bg-card",
        className,
      )}
    >
      {Icon ? (
        <div className="mb-4 flex size-10 items-center justify-center rounded-lg bg-muted text-muted-foreground">
          <Icon className="size-5" aria-hidden="true" />
        </div>
      ) : null}
      <p className="type-h4">{title}</p>
      {description ? (
        <p className="type-body mt-1.5 max-w-sm text-pretty text-muted-foreground">
          {description}
        </p>
      ) : null}
      {action ? <div className="mt-5">{action}</div> : null}
    </div>
  );
}
