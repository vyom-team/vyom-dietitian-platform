import type { Metadata } from "next";
import { BarChart3 } from "lucide-react";

import { PhasePlaceholder } from "@/components/shared/phase-placeholder";

export const metadata: Metadata = { title: "Reports" };

export default function ReportsPage() {
  return (
    <PhasePlaceholder
      title="Reports"
      description="Track adherence, progress trends, and practice activity."
      icon={BarChart3}
      phase="the practitioner analytics phase"
    />
  );
}
