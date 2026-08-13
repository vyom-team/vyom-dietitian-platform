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
import { signUp, type ActionState } from "@/lib/auth/actions";

const initialState: ActionState = { status: "idle" };

export function RegisterForm({ redirectTo }: { redirectTo?: string }) {
  const [state, formAction] = useActionState(signUp, initialState);

  // After a successful sign-up there is nothing left to fill in — the next step
  // is in the user's inbox, so the form is replaced by the confirmation.
  if (state.status === "success") {
    return <FormMessage state={state} />;
  }

  return (
    <form action={formAction} noValidate>
      <FieldGroup>
        <FormMessage state={state} />

        {/* Re-validated server-side; a tampered value falls back to the default. */}
        <input type="hidden" name="redirectTo" value={redirectTo ?? ""} />

        <Field>
          <FieldLabel htmlFor="fullName">Your name</FieldLabel>
          <Input
            id="fullName"
            name="fullName"
            autoComplete="name"
            required
            aria-describedby={
              state.fieldErrors?.fullName ? "fullName-error" : undefined
            }
            aria-invalid={state.fieldErrors?.fullName ? true : undefined}
          />
          <FieldError id="fullName-error" message={state.fieldErrors?.fullName} />
        </Field>

        <Field>
          <FieldLabel htmlFor="email">Work email</FieldLabel>
          <Input
            id="email"
            name="email"
            type="email"
            autoComplete="email"
            required
            placeholder="you@practice.com"
            aria-describedby={state.fieldErrors?.email ? "email-error" : undefined}
            aria-invalid={state.fieldErrors?.email ? true : undefined}
          />
          <FieldError id="email-error" message={state.fieldErrors?.email} />
        </Field>

        <Field>
          <FieldLabel htmlFor="password">Password</FieldLabel>
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
          <FieldLabel htmlFor="confirmPassword">Confirm password</FieldLabel>
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

        <SubmitButton className="w-full" pendingLabel="Creating account…">
          Create account
        </SubmitButton>
      </FieldGroup>
    </form>
  );
}
