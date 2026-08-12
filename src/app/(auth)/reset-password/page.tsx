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

export const metadata: Metadata = { title: "Set a new password" };

/** Layout only. Token validation belongs to the authentication phase. */
export default function ResetPasswordPage() {
  return (
    <AuthCard
      title="Set a new password"
      description="Choose a password you don't use anywhere else."
      footer={<AuthLink href="/login">Back to sign in</AuthLink>}
    >
      <FieldGroup>
        <Field>
          <FieldLabel htmlFor="password">New password</FieldLabel>
          <Input id="password" type="password" autoComplete="new-password" />
          <FieldDescription>At least 8 characters.</FieldDescription>
        </Field>

        <Field>
          <FieldLabel htmlFor="confirm">Confirm new password</FieldLabel>
          <Input id="confirm" type="password" autoComplete="new-password" />
        </Field>

        <Button className="w-full" disabled>
          Update password
        </Button>
      </FieldGroup>
    </AuthCard>
  );
}
