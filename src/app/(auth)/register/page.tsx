import type { Metadata } from "next";

import { AuthCard, AuthLink } from "@/components/layout/auth-card";
import { Button } from "@/components/ui/button";
import {
  Field,
  FieldDescription,
  FieldGroup,
  FieldLabel,
} from "@/components/ui/field";
import { Input } from "@/components/ui/input";

export const metadata: Metadata = { title: "Create your practice" };

/** Layout only. Organization creation is a later phase. */
export default function RegisterPage() {
  return (
    <AuthCard
      title="Create your practice"
      description="Start your free trial. No card required."
      footer={
        <>
          Already have an account? <AuthLink href="/login">Sign in</AuthLink>
        </>
      }
    >
      <FieldGroup>
        <Field>
          <FieldLabel htmlFor="practice">Practice name</FieldLabel>
          <Input id="practice" placeholder="e.g. Healthy Life Clinic" />
          <FieldDescription>You can change this later.</FieldDescription>
        </Field>

        <Field>
          <FieldLabel htmlFor="name">Your name</FieldLabel>
          <Input id="name" autoComplete="name" />
        </Field>

        <Field>
          <FieldLabel htmlFor="email">Work email</FieldLabel>
          <Input
            id="email"
            type="email"
            autoComplete="email"
            placeholder="you@practice.com"
          />
        </Field>

        <Field>
          <FieldLabel htmlFor="password">Password</FieldLabel>
          <Input id="password" type="password" autoComplete="new-password" />
        </Field>

        <Button className="w-full" disabled>
          Create practice
        </Button>
      </FieldGroup>
    </AuthCard>
  );
}
