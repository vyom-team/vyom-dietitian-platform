import { KeyRound } from "lucide-react";

/**
 * Shown when Supabase environment variables are absent.
 *
 * Better than a crash or a form that silently fails: the environment is
 * misconfigured, and saying so plainly is more useful than a generic error. It
 * names the variables but of course never their values.
 */
export function AuthNotConfigured() {
  return (
    <div className="flex flex-col items-center gap-3 py-4 text-center">
      <div className="flex size-10 items-center justify-center rounded-lg bg-muted text-muted-foreground">
        <KeyRound className="size-5" aria-hidden="true" />
      </div>
      <p className="type-h4">Authentication is not configured</p>
      <p className="type-body-sm text-pretty text-muted-foreground">
        Set <code className="rounded bg-muted px-1">NEXT_PUBLIC_SUPABASE_URL</code>{" "}
        and{" "}
        <code className="rounded bg-muted px-1">
          NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY
        </code>{" "}
        in <code className="rounded bg-muted px-1">.env.local</code>, then
        restart the dev server. See docs/authentication.md.
      </p>
    </div>
  );
}
