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
import { updatePassword, type ActionState } from "@/lib/auth/actions";

const initialState: ActionState = { status: "idle" };

export function ResetPasswordForm() {
  const [state, formAction] = useActionState(updatePassword, initialState);

  return (
    <form action={formAction} noValidate>
      <FieldGroup>
        <FormMessage state={state} />

        <Field>
          <FieldLabel htmlFor="password">New password</FieldLabel>
          <Input
            id="password"
            name="password"
            type="password"
            autoComplete="new-password"
            required
            aria-describedby="password-hint password-error"
            aria-invalid={state.fieldErrors?.password ? true : undefined}
          />
          <FieldDescription id="password-hint">
            At least 10 characters.
          </FieldDescription>
          <FieldError id="password-error" message={state.fieldErrors?.password} />
        </Field>

        <Field>
          <FieldLabel htmlFor="confirmPassword">Confirm new password</FieldLabel>
          <Input
            id="confirmPassword"
            name="confirmPassword"
            type="password"
            autoComplete="new-password"
            required
            aria-describedby={
              state.fieldErrors?.confirmPassword ? "confirm-error" : undefined
            }
            aria-invalid={state.fieldErrors?.confirmPassword ? true : undefined}
          />
          <FieldError
            id="confirm-error"
            message={state.fieldErrors?.confirmPassword}
          />
        </Field>

        <SubmitButton className="w-full" pendingLabel="Updating password…">
          Update password
        </SubmitButton>
      </FieldGroup>
    </form>
  );
}
