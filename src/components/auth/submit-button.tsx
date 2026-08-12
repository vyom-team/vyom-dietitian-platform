"use client";

import { useFormStatus } from "react-dom";

import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";

/**
 * Submit button that reflects the parent form's pending state.
 *
 * Disabling while in flight is what prevents double submission — a duplicate
 * sign-up would otherwise send two confirmation emails, and a duplicate sign-in
 * burns rate limit for no reason.
 */
export function SubmitButton({
  children,
  pendingLabel,
  className,
}: {
  children: React.ReactNode;
  pendingLabel: string;
  className?: string;
}) {
  const { pending } = useFormStatus();

  return (
    <Button type="submit" className={className} disabled={pending} aria-busy={pending}>
      {pending ? (
        <>
          <Spinner className="size-4" />
          {pendingLabel}
        </>
      ) : (
        children
      )}
    </Button>
  );
}
