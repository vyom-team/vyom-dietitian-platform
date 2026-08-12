import type { Metadata } from "next";
import { CreditCard } from "lucide-react";

import { PhasePlaceholder } from "@/components/shared/phase-placeholder";

export const metadata: Metadata = { title: "Subscription" };

export default function SubscriptionPage() {
  return (
    <PhasePlaceholder
      title="Subscription"
      description="Manage your plan, usage limits, and billing."
      icon={CreditCard}
      phase="the subscription and billing phase"
    />
  );
}
