import type { Metadata } from "next";

import { Container } from "@/components/shared/container";
import { EmptyState } from "@/components/shared/empty-state";

export const metadata: Metadata = { title: "Contact" };

export default function ContactPage() {
  return (
    <Container className="py-20">
      <h1 className="type-h1">Contact</h1>
      <p className="type-body mt-3 max-w-2xl text-muted-foreground">
        Questions about Vyom for your practice.
      </p>
      <EmptyState
        className="mt-10"
        title="Contact form coming soon"
        description="Submitting a form needs a mail service, which is wired up in a later phase."
      />
    </Container>
  );
}
