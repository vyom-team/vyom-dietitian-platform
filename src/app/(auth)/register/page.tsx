import type { Metadata } from "next";

import { RegisterForm } from "@/components/auth/register-form";
import { AuthCard, AuthLink } from "@/components/layout/auth-card";
import { AuthNotConfigured } from "@/components/auth/auth-not-configured";
import { isAuthConfigured } from "@/config/env";

export const metadata: Metadata = { title: "Create your account" };

export default async function RegisterPage({
  searchParams,
}: PageProps<"/register">) {
  const params = await searchParams;
  const next = typeof params.next === "string" ? params.next : undefined;

  return (
    <AuthCard
      title="Create your account"
      description="Start your free trial. No card required."
      footer={
        <>
          Already have an account? <AuthLink href="/login">Sign in</AuthLink>
        </>
      }
    >
      {isAuthConfigured ? <RegisterForm redirectTo={next} /> : <AuthNotConfigured />}
    </AuthCard>
  );
}
