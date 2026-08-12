import type { Metadata } from "next";

import { ResetPasswordForm } from "@/components/auth/reset-password-form";
import { AuthCard, AuthLink } from "@/components/layout/auth-card";
import { AuthNotConfigured } from "@/components/auth/auth-not-configured";
import { isAuthConfigured } from "@/config/env";

export const metadata: Metadata = { title: "Set a new password" };

export default function ResetPasswordPage() {
  return (
    <AuthCard
      title="Set a new password"
      description="Choose a password you don't use anywhere else."
      footer={<AuthLink href="/login">Back to sign in</AuthLink>}
    >
      {isAuthConfigured ? <ResetPasswordForm /> : <AuthNotConfigured />}
    </AuthCard>
  );
}
