import { cn } from "@/lib/utils";

type PageHeaderProps = {
  title: string;
  description?: string;
  /** Rendered above the title. Use the `Breadcrumbs` component. */
  breadcrumb?: React.ReactNode;
  /** Primary action, trailing edge. */
  action?: React.ReactNode;
  /** Secondary actions, placed before the primary action. */
  secondaryActions?: React.ReactNode;
  className?: string;
};

/**
 * Standard page title block.
 *
 * Owns heading level 1 for the page, so pages should not render their own `h1`.
 */
export function PageHeader({
  title,
  description,
  breadcrumb,
  action,
  secondaryActions,
  className,
}: PageHeaderProps) {
  return (
    <div className={cn("space-y-4", className)}>
      {breadcrumb}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0 space-y-1.5">
          <h1 className="type-h1">{title}</h1>
          {description ? (
            <p className="type-body max-w-2xl text-pretty text-muted-foreground">
              {description}
            </p>
          ) : null}
        </div>
        {action || secondaryActions ? (
          <div className="flex shrink-0 items-center gap-2">
            {secondaryActions}
            {action}
          </div>
        ) : null}
      </div>
    </div>
  );
}
