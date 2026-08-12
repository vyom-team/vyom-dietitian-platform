import type { Metadata } from "next";
import { CalendarRange } from "lucide-react";

import { PhasePlaceholder } from "@/components/shared/phase-placeholder";

export const metadata: Metadata = { title: "Meal Plans" };

export default function PlansPage() {
  return (
    <PhasePlaceholder
      title="Meal Plans"
      description="Build, review, and version weekly plans for your clients."
      icon={CalendarRange}
      phase="the meal plan generator and plan editor phases"
    />
  );
}
