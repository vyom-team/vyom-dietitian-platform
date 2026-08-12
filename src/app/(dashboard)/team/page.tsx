import type { Metadata } from "next";
import { Users } from "lucide-react";

import { PhasePlaceholder } from "@/components/shared/phase-placeholder";

export const metadata: Metadata = { title: "Team" };

export default function TeamPage() {
  return (
    <PhasePlaceholder
      title="Team"
      description="Invite dietitians and staff to your practice."
      icon={Users}
      phase="a later phase, once organizations and roles exist"
    />
  );
}
