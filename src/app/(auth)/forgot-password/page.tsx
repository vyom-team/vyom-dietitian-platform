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

export const metadata: Metadata = { title: "Reset your password" };

/** Layout only. Sending reset email requires the mail service. */
export default function ForgotPasswordPage() {
  return (
    <AuthCard
      title="Reset your password"
      description="We'll email you a link to set a new one."
      footer={<AuthLink href="/login">Back to sign in</AuthLink>}
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
          <FieldDescription>
            Use the address you signed up with.
          </FieldDescription>
        </Field>

        <Button className="w-full" disabled>
          Send reset link
        </Button>
      </FieldGroup>
    </AuthCard>
  );
}
