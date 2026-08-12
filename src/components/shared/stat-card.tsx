import type { LucideIcon } from "lucide-react";
import { Minus, TrendingDown, TrendingUp } from "lucide-react";

import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

type Trend = {
  direction: "up" | "down" | "flat";
  label: string;
  /**
   * Whether the direction is good news. Weight going down is positive for a
   * weight-loss client and negative for a weight-gain client, so the caller
   * decides — the component never infers it.
   */
  sentiment?: "positive" | "negative" | "neutral";
};

type StatCardProps = {
  label: string;
  value: string;
  hint?: string;
  icon?: LucideIcon;
  trend?: Trend;
  /**
   * `primary` is for the single most important metric on a page. Using it more
   * than once removes the hierarchy it exists to create.
   */
  emphasis?: "primary" | "default";
  className?: string;
};

const trendIcons = {
  up: TrendingUp,
  down: TrendingDown,
  flat: Minus,
} as const;

const trendTones = {
  positive: "text-success",
  negative: "text-destructive",
  neutral: "text-muted-foreground",
} as const;

export function StatCard({
  label,
  value,
  hint,
  icon: Icon,
  trend,
  emphasis = "default",
  className,
}: StatCardProps) {
  const TrendIcon = trend ? trendIcons[trend.direction] : null;

  return (
    <div
      className={cn(
        "rounded-xl border bg-card p-5",
        emphasis === "primary" && "ring-1 ring-primary/15",
        className,
      )}
    >
      <div className="flex items-center justify-between gap-3">
        <p className="type-caption font-medium tracking-wide uppercase">
          {label}
        </p>
        {Icon ? (
          <Icon
            className={cn(
              "size-4 shrink-0",
              emphasis === "primary" ? "text-primary" : "text-muted-foreground",
            )}
            aria-hidden="true"
          />
        ) : null}
      </div>

      <p className="type-metric mt-3">{value}</p>

      {trend || hint ? (
        <div className="mt-2 flex items-center gap-1.5">
          {trend && TrendIcon ? (
            <span
              className={cn(
                "type-body-sm inline-flex items-center gap-1 font-medium",
                trendTones[trend.sentiment ?? "neutral"],
              )}
            >
              <TrendIcon className="size-3.5" aria-hidden="true" />
              {trend.label}
            </span>
          ) : null}
          {hint ? <span className="type-caption">{hint}</span> : null}
        </div>
      ) : null}
    </div>
  );
}

export function StatCardSkeleton() {
  return (
    <div className="rounded-xl border bg-card p-5">
      <Skeleton className="h-3 w-24" />
      <Skeleton className="mt-4 h-8 w-16" />
      <Skeleton className="mt-3 h-3 w-32" />
    </div>
  );
}
