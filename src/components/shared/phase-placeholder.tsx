import type { LucideIcon } from "lucide-react";
import { Construction } from "lucide-react";

import { EmptyState } from "@/components/shared/empty-state";
import { StandardPage } from "@/components/templates/page-templates";

/**
 * Placeholder for a route whose feature belongs to a later phase.
 *
 * Being explicit about this beats a half-built screen: it keeps navigation and
 * layout testable without implying functionality that does not exist.
 */
export function PhasePlaceholder({
  title,
  description,
  icon = Construction,
  phase,
}: {
  title: string;
  description: string;
  icon?: LucideIcon;
  phase: string;
}) {
  return (
    <StandardPage title={title} description={description}>
      <EmptyState
        icon={icon}
        title="Not built yet"
        description={`This area is implemented in ${phase}. The route, layout, and navigation exist so the shell can be tested end to end.`}
      />
    </StandardPage>
  );
}
