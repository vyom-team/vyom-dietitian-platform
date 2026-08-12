import type { Metadata } from "next";

import { ForgotPasswordForm } from "@/components/auth/forgot-password-form";
import { AuthCard, AuthLink } from "@/components/layout/auth-card";
import { AuthNotConfigured } from "@/components/auth/auth-not-configured";
import { isAuthConfigured } from "@/config/env";

export const metadata: Metadata = { title: "Reset your password" };

export default function ForgotPasswordPage() {
  return (
    <AuthCard
      title="Reset your password"
      description="We'll email you a link to set a new one."
      footer={<AuthLink href="/login">Back to sign in</AuthLink>}
    >
      {isAuthConfigured ? <ForgotPasswordForm /> : <AuthNotConfigured />}
    </AuthCard>
  );
}
