import type { Metadata } from "next";
import { Database } from "lucide-react";

import { Section } from "@/components/shared/section";
import { StatusBadge } from "@/components/shared/status-badge";
import { StandardPage } from "@/components/templates/page-templates";
import { checkDatabaseHealth } from "@/lib/db-health";

export const metadata: Metadata = { title: "System status" };

/**
 * Development-only database connection check.
 *
 * A server component, so the query runs on the server and no connection detail
 * ever reaches the browser. It reports connectivity and migration count only —
 * never the host, credentials, or raw driver errors.
 *
 * `force-dynamic` because a build-time snapshot of connectivity is meaningless.
 */
export const dynamic = "force-dynamic";

export default async function SystemStatusPage() {
  const health = await checkDatabaseHealth();

  return (
    <StandardPage
      title="System status"
      description="Development diagnostics for the Vyom database connection."
    >
      <Section title="Database">
        <div className="overflow-hidden rounded-xl border bg-card">
          <div className="flex flex-wrap items-center gap-3 border-b p-4">
            <Database className="size-4 text-muted-foreground" aria-hidden="true" />
            <p className="type-body min-w-0 flex-1 font-medium">
              PostgreSQL connection
            </p>
            {health.state === "connected" ? (
              <StatusBadge tone="success">Connected</StatusBadge>
            ) : health.state === "not-configured" ? (
              <StatusBadge tone="info">Not configured</StatusBadge>
            ) : (
              <StatusBadge tone="destructive">Unavailable</StatusBadge>
            )}
          </div>

          <dl className="divide-y">
            {health.state === "connected" ? (
              <>
                <Row label="Server" value={health.server} />
                <Row
                  label="Migrations applied"
                  value={String(health.migrationsApplied)}
                />
              </>
            ) : health.state === "not-configured" ? (
              <Row
                label="Setup"
                value="Copy .env.example to .env.local and set DATABASE_URL. See docs/database.md."
              />
            ) : (
              <Row label="Detail" value={health.reason} />
            )}
          </dl>
        </div>

        <p className="type-caption">
          Connection details are never rendered here. This page reports
          reachability only.
        </p>
      </Section>
    </StandardPage>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="grid gap-1 p-4 sm:grid-cols-[12rem_1fr] sm:gap-4">
      <dt className="type-caption">{label}</dt>
      <dd className="type-body text-pretty">{value}</dd>
    </div>
  );
}
