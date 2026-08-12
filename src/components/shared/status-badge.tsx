import type { LucideIcon } from "lucide-react";
import { AlertTriangle, CheckCircle2, CircleDot, Info, XCircle } from "lucide-react";

import { cn } from "@/lib/utils";

export type StatusTone = "success" | "warning" | "destructive" | "info" | "neutral";

const tones: Record<StatusTone, { className: string; icon: LucideIcon }> = {
  success: {
    className: "bg-success-subtle text-success border-success/20",
    icon: CheckCircle2,
  },
  warning: {
    className: "bg-warning-subtle text-warning border-warning/25",
    icon: AlertTriangle,
  },
  destructive: {
    className: "bg-destructive-subtle text-destructive border-destructive/20",
    icon: XCircle,
  },
  info: {
    className: "bg-info-subtle text-info border-info/20",
    icon: Info,
  },
  neutral: {
    className: "bg-muted text-muted-foreground border-transparent",
    icon: CircleDot,
  },
};

/**
 * Status pill.
 *
 * Always renders an icon alongside the label so status is never communicated by
 * colour alone — required for colour-blind users and WCAG 1.4.1.
 */
export function StatusBadge({
  tone = "neutral",
  children,
  className,
}: {
  tone?: StatusTone;
  children: React.ReactNode;
  className?: string;
}) {
  const { className: toneClass, icon: Icon } = tones[tone];

  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-md border px-2 py-0.5 text-xs font-medium whitespace-nowrap",
        toneClass,
        className,
      )}
    >
      <Icon className="size-3.5 shrink-0" aria-hidden="true" />
      {children}
    </span>
  );
}
