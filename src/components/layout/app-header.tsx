import Link from "next/link";
import { Leaf } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Container } from "@/components/shared/container";
import { siteConfig } from "@/config/site";

/**
 * Application shell header.
 *
 * Placeholder for Phase 0: it establishes the layout and branding only.
 * Navigation, organization switching, and the user menu arrive in later phases
 * once authentication and multi-tenancy exist.
 */
export function AppHeader() {
  return (
    <header className="sticky top-0 z-50 border-b bg-background/80 backdrop-blur-sm">
      <Container className="flex h-14 items-center justify-between gap-4">
        <Link
          href="/"
          className="flex items-center gap-2 rounded-md outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
        >
          <span className="flex size-7 items-center justify-center rounded-md bg-primary text-primary-foreground">
            <Leaf className="size-4" aria-hidden="true" />
          </span>
          <span className="font-heading text-base font-semibold tracking-tight">
            {siteConfig.name}
          </span>
        </Link>

        <Badge variant="secondary" className="font-normal">
          {siteConfig.phase}
        </Badge>
      </Container>
    </header>
  );
}
