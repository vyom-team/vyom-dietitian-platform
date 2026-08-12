"use client";

import { useActionState } from "react";

import { FieldError, FormMessage } from "@/components/auth/form-message";
import { SubmitButton } from "@/components/auth/submit-button";
import { AuthLink } from "@/components/layout/auth-card";
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { signIn, type ActionState } from "@/lib/auth/actions";

const initialState: ActionState = { status: "idle" };

export function LoginForm({ redirectTo }: { redirectTo?: string }) {
  const [state, formAction] = useActionState(signIn, initialState);

  return (
    <form action={formAction} noValidate>
      <FieldGroup>
        <FormMessage state={state} />

        {/*
          The post-sign-in destination travels as a hidden field, but the server
          re-validates it through safeRedirectPath — a tampered value here can
          only ever fall back to the default landing page.
        */}
        <input type="hidden" name="redirectTo" value={redirectTo ?? ""} />

        <Field>
          <FieldLabel htmlFor="email">Email</FieldLabel>
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
          <div className="flex items-center justify-between">
            <FieldLabel htmlFor="password">Password</FieldLabel>
            <AuthLink href="/forgot-password">Forgot?</AuthLink>
          </div>
          <Input
            id="password"
            name="password"
            type="password"
            autoComplete="current-password"
            required
            aria-describedby={
              state.fieldErrors?.password ? "password-error" : undefined
            }
            aria-invalid={state.fieldErrors?.password ? true : undefined}
          />
          <FieldError id="password-error" message={state.fieldErrors?.password} />
        </Field>

        <SubmitButton className="w-full" pendingLabel="Signing in…">
          Sign in
        </SubmitButton>
      </FieldGroup>
    </form>
  );
}
