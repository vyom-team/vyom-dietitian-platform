import { AlertCircle, CheckCircle2 } from "lucide-react";

import type { ActionState } from "@/lib/auth/actions";
import { cn } from "@/lib/utils";

/**
 * Form-level feedback.
 *
 * `role="alert"` so screen readers announce the result without the user having
 * to hunt for it, and the icon means the outcome is not conveyed by colour
 * alone.
 */
export function FormMessage({ state }: { state: ActionState }) {
  if (state.status === "idle" || !state.message) return null;

  const isError = state.status === "error";

  return (
    <div
      role="alert"
      className={cn(
        "flex items-start gap-2 rounded-md border p-3 text-sm",
        isError
          ? "border-destructive/20 bg-destructive-subtle text-destructive"
          : "border-success/20 bg-success-subtle text-success",
      )}
    >
      {isError ? (
        <AlertCircle className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
      ) : (
        <CheckCircle2 className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
      )}
      <p className="text-pretty">{state.message}</p>
    </div>
  );
}

/** Inline field error, linked to its input via `aria-describedby`. */
export function FieldError({ id, message }: { id: string; message?: string }) {
  if (!message) return null;
  return (
    <p id={id} className="text-sm text-destructive">
      {message}
    </p>
  );
}
