"use client";

import { useActionState } from "react";
import { AlertCircle } from "lucide-react";

import { SubmitButton } from "@/components/auth/submit-button";
import {
  acceptInvitationAction,
  type AcceptInvitationState,
} from "@/lib/team/actions";

const initialState: AcceptInvitationState = { status: "idle" };

/**
 * Accept button.
 *
 * A form posting to a Server Action, so acceptance is a POST rather than
 * something a link prefetch or an email scanner could trigger by following the
 * URL. The token travels as a hidden field and is re-validated server-side.
 */
export function AcceptInvitationForm({
  token,
  practiceName,
}: {
  token: string;
  practiceName: string;
}) {
  const [state, formAction] = useActionState(acceptInvitationAction, initialState);

  return (
    <form action={formAction} className="space-y-3">
      {state.status === "error" && state.message ? (
        <div
          role="alert"
          className="flex items-start gap-2 rounded-md border border-destructive/20 bg-destructive-subtle p-3 text-sm text-destructive"
        >
          <AlertCircle className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
          <p className="text-pretty">{state.message}</p>
        </div>
      ) : null}

      <input type="hidden" name="token" value={token} />

      <SubmitButton className="w-full" pendingLabel="Joining…">
        Join {practiceName}
      </SubmitButton>
    </form>
  );
}
