import type { Metadata } from "next";

import { AuthCard, AuthLink } from "@/components/layout/auth-card";
import { Button } from "@/components/ui/button";
import {
  Field,
  FieldGroup,
  FieldLabel,
} from "@/components/ui/field";
import { Input } from "@/components/ui/input";

export const metadata: Metadata = { title: "Sign in" };

/** Layout only. The form does not submit — authentication is a later phase. */
export default function LoginPage() {
  return (
    <AuthCard
      title="Sign in"
      description="Access your practice dashboard."
      footer={
        <>
          New to Vyom? <AuthLink href="/register">Create a practice</AuthLink>
        </>
      }
    >
      <FieldGroup>
        <Field>
          <FieldLabel htmlFor="email">Email</FieldLabel>
          <Input
            id="email"
            type="email"
            autoComplete="email"
            placeholder="you@practice.com"
          />
        </Field>

        <Field>
          <div className="flex items-center justify-between">
            <FieldLabel htmlFor="password">Password</FieldLabel>
            <AuthLink href="/forgot-password">Forgot?</AuthLink>
          </div>
          <Input id="password" type="password" autoComplete="current-password" />
        </Field>

        <Button className="w-full" disabled>
          Sign in
        </Button>
      </FieldGroup>
    </AuthCard>
  );
}
