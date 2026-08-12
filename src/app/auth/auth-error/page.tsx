import type { Metadata } from "next";
import Link from "next/link";

import { Button } from "@/components/ui/button";

export const metadata: Metadata = { title: "Link problem" };

/**
 * Landing page for a failed auth callback.
 *
 * `reason` is a fixed enum we control, never text reflected from the provider,
 * so nothing attacker-supplied is rendered here.
 */
const REASONS: Record<string, string> = {
  link: "That link has expired or has already been used.",
  missing: "That link is missing the information we need to sign you in.",
};

export default async function AuthErrorPage({
  searchParams,
}: PageProps<"/auth/auth-error">) {
  const params = await searchParams;
  const reason = typeof params.reason === "string" ? params.reason : "";
  const description = REASONS[reason] ?? "We couldn't complete that request.";

  return (
    <div className="flex min-h-svh items-center justify-center px-4">
      <div className="max-w-sm text-center">
        <h1 className="type-h2">Sign-in link problem</h1>
        <p className="type-body mt-3 text-pretty text-muted-foreground">
          {description} Request a new one and it will arrive within a minute.
        </p>
        <div className="mt-8 flex flex-col gap-2 sm:flex-row sm:justify-center">
          <Button asChild>
            <Link href="/forgot-password">Request a new link</Link>
          </Button>
          <Button variant="outline" asChild>
            <Link href="/login">Back to sign in</Link>
          </Button>
        </div>
      </div>
    </div>
  );
}
