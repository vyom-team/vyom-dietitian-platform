"use client";

import { useActionState } from "react";

import { FieldError, FormMessage } from "@/components/auth/form-message";
import { SubmitButton } from "@/components/auth/submit-button";
import {
  Field,
  FieldDescription,
  FieldGroup,
  FieldLabel,
} from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { requestPasswordReset, type ActionState } from "@/lib/auth/actions";

const initialState: ActionState = { status: "idle" };

export function ForgotPasswordForm() {
  const [state, formAction] = useActionState(requestPasswordReset, initialState);

  if (state.status === "success") {
    return <FormMessage state={state} />;
  }

  return (
    <form action={formAction} noValidate>
      <FieldGroup>
        <FormMessage state={state} />

        <Field>
          <FieldLabel htmlFor="email">Email</FieldLabel>
          <Input
            id="email"
            name="email"
            type="email"
            autoComplete="email"
            required
            placeholder="you@practice.com"
            aria-describedby="email-hint email-error"
            aria-invalid={state.fieldErrors?.email ? true : undefined}
          />
          <FieldDescription id="email-hint">
            Use the address you signed up with.
          </FieldDescription>
          <FieldError id="email-error" message={state.fieldErrors?.email} />
        </Field>

        <SubmitButton className="w-full" pendingLabel="Sending reset link…">
          Send reset link
        </SubmitButton>
      </FieldGroup>
    </form>
  );
}
