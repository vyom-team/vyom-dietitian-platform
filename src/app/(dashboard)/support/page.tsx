import type { Metadata } from "next";
import { LifeBuoy } from "lucide-react";

import { PhasePlaceholder } from "@/components/shared/phase-placeholder";

export const metadata: Metadata = { title: "Help & Support" };

export default function SupportPage() {
  return (
    <PhasePlaceholder
      title="Help & Support"
      description="Guides, documentation, and getting in touch with us."
      icon={LifeBuoy}
      phase="a later phase"
    />
  );
}
