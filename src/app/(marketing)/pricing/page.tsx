import type { Metadata } from "next";

import { Container } from "@/components/shared/container";
import { EmptyState } from "@/components/shared/empty-state";

export const metadata: Metadata = { title: "Pricing" };

export default function PricingPage() {
  return (
    <Container className="py-20">
      <h1 className="type-h1">Pricing</h1>
      <p className="type-body mt-3 max-w-2xl text-muted-foreground">
        Free, Professional, Clinic, and Enterprise tiers.
      </p>
      <EmptyState
        className="mt-10"
        title="Pricing not published yet"
        description="Plan limits and prices are configured as data in the billing phase, so nothing is hard-coded here."
      />
    </Container>
  );
}
