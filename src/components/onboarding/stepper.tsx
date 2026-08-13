import { Check } from "lucide-react";

import { cn } from "@/lib/utils";

export type Step = { id: string; label: string };

/**
 * Onboarding progress indicator.
 *
 * Rendered as an ordered list so its meaning survives without CSS, and the
 * current step carries `aria-current="step"`. The state of each step is also
 * spelled out for screen readers rather than being implied by a tick icon or a
 * colour, both of which are invisible to them.
 */
export function Stepper({
  steps,
  currentIndex,
}: {
  steps: readonly Step[];
  currentIndex: number;
}) {
  return (
    <nav aria-label="Progress">
      <ol className="flex items-center gap-2">
        {steps.map((step, index) => {
          const isComplete = index < currentIndex;
          const isCurrent = index === currentIndex;

          return (
            <li key={step.id} className="flex flex-1 items-center gap-2">
              <span
                aria-current={isCurrent ? "step" : undefined}
                className="flex items-center gap-2"
              >
                <span
                  className={cn(
                    "flex size-6 shrink-0 items-center justify-center rounded-full border text-xs font-medium transition-colors",
                    isComplete && "border-primary bg-primary text-primary-foreground",
                    isCurrent && "border-primary text-primary",
                    !isComplete && !isCurrent && "border-border text-muted-foreground",
                  )}
                >
                  {isComplete ? (
                    <Check className="size-3.5" aria-hidden="true" />
                  ) : (
                    index + 1
                  )}
                </span>
                <span
                  className={cn(
                    "type-body-sm hidden font-medium sm:inline",
                    isCurrent ? "text-foreground" : "text-muted-foreground",
                  )}
                >
                  {step.label}
                </span>
                <span className="sr-only">
                  {step.label} —{" "}
                  {isComplete ? "completed" : isCurrent ? "current step" : "not started"}
                </span>
              </span>

              {index < steps.length - 1 ? (
                <span
                  aria-hidden="true"
                  className={cn(
                    "h-px flex-1 transition-colors",
                    isComplete ? "bg-primary" : "bg-border",
                  )}
                />
              ) : null}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
