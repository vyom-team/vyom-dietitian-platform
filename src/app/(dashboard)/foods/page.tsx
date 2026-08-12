import type { Metadata } from "next";
import { Apple } from "lucide-react";

import { PhasePlaceholder } from "@/components/shared/phase-placeholder";

export const metadata: Metadata = { title: "Food Database" };

export default function FoodsPage() {
  return (
    <PhasePlaceholder
      title="Food Database"
      description="Search Indian foods and view their reference nutrition data."
      icon={Apple}
      phase="the food database phase"
    />
  );
}
