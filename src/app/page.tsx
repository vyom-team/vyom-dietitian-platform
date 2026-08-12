import { CheckCircle2, Circle } from "lucide-react";

import { AppShell } from "@/components/layout/app-shell";
import { Container } from "@/components/shared/container";
import { PageHeader } from "@/components/shared/page-header";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { siteConfig } from "@/config/site";

/**
 * Placeholder landing page.
 *
 * Its only job is to prove the shell, design tokens, and component system
 * render correctly. It is not the product's home page and carries no business
 * logic — the practitioner dashboard is built in a later phase.
 */

const foundation = [
  { label: "Next.js App Router + TypeScript (strict)", done: true },
  { label: "Tailwind CSS v4 + design tokens", done: true },
  { label: "shadcn/ui component system", done: true },
  { label: "Form, validation, state, and data-fetching libraries", done: true },
  { label: "Environment variable structure", done: true },
  { label: "Database, auth, and product features", done: false },
];

export default function HomePage() {
  return (
    <AppShell>
      <Container className="space-y-10">
        <PageHeader
          title="Development foundation"
          description={siteConfig.description}
        />

        <Card className="shadow-card">
          <CardHeader className="border-b">
            <CardTitle>{siteConfig.phase}</CardTitle>
            <CardDescription>
              Scaffolding only. Product functionality is implemented in
              subsequent phases, one phase at a time.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <ul className="divide-y">
              {foundation.map((item) => (
                <li key={item.label} className="flex items-center gap-3 py-2.5">
                  {item.done ? (
                    <CheckCircle2
                      className="size-4 shrink-0 text-primary"
                      aria-hidden="true"
                    />
                  ) : (
                    <Circle
                      className="size-4 shrink-0 text-muted-foreground/50"
                      aria-hidden="true"
                    />
                  )}
                  <span
                    className={
                      item.done ? "text-foreground" : "text-muted-foreground"
                    }
                  >
                    {item.label}
                  </span>
                  <span className="sr-only">
                    {item.done ? "complete" : "not started"}
                  </span>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      </Container>
    </AppShell>
  );
}
