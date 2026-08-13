import { LogOut } from "lucide-react";

import { Button } from "@/components/ui/button";
import { signOut } from "@/lib/auth/actions";

/**
 * Sign out.
 *
 * A form posting to a Server Action rather than a client handler: clearing the
 * httpOnly session cookie is something only the server can do.
 */
export function SignOutButton({ label = "Sign out" }: { label?: string }) {
  return (
    <form action={signOut}>
      <Button type="submit" variant="ghost" size="sm">
        <LogOut className="size-4" aria-hidden="true" />
        {label}
      </Button>
    </form>
  );
}
