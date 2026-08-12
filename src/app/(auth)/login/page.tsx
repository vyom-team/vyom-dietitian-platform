import type { Metadata } from "next";

import { LoginForm } from "@/components/auth/login-form";
import { AuthCard, AuthLink } from "@/components/layout/auth-card";
import { AuthNotConfigured } from "@/components/auth/auth-not-configured";
import { isAuthConfigured } from "@/config/env";

export const metadata: Metadata = { title: "Sign in" };

export default async function LoginPage({
  searchParams,
}: PageProps<"/login">) {
  const params = await searchParams;
  const next = typeof params.next === "string" ? params.next : undefined;

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
      {isAuthConfigured ? <LoginForm redirectTo={next} /> : <AuthNotConfigured />}
    </AuthCard>
  );
}
