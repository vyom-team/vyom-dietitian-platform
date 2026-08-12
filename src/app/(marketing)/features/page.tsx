import type { Metadata } from "next";

import { Container } from "@/components/shared/container";
import { EmptyState } from "@/components/shared/empty-state";

export const metadata: Metadata = { title: "Features" };

export default function FeaturesPage() {
  return (
    <Container className="py-20">
      <h1 className="type-h1">Features</h1>
      <p className="type-body mt-3 max-w-2xl text-muted-foreground">
        A detailed walkthrough of what Vyom does.
      </p>
      <EmptyState
        className="mt-10"
        title="Page in progress"
        description="The marketing site is built out once the product it describes exists."
      />
    </Container>
  );
}
