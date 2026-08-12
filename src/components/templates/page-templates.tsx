import { PageHeader } from "@/components/shared/page-header";
import { Breadcrumbs, type Crumb } from "@/components/shared/breadcrumbs";
import { cn } from "@/lib/utils";

/**
 * Page templates.
 *
 * These encode the four page shapes Vyom uses so future phases compose a screen
 * instead of re-inventing its layout. They are layout only — no data, no state.
 */

type BaseProps = {
  title: string;
  description?: string;
  breadcrumbs?: Crumb[];
  action?: React.ReactNode;
  secondaryActions?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
};

/** Page header, then content. The default shape. */
export function StandardPage({
  title,
  description,
  breadcrumbs,
  action,
  secondaryActions,
  children,
  className,
}: BaseProps) {
  return (
    <div className={cn("space-y-8", className)}>
      <PageHeader
        title={title}
        description={description}
        breadcrumb={breadcrumbs ? <Breadcrumbs items={breadcrumbs} /> : undefined}
        action={action}
        secondaryActions={secondaryActions}
      />
      {children}
    </div>
  );
}

/** Header, then a toolbar of search/filters, then a table or list. */
export function ListPage({
  title,
  description,
  breadcrumbs,
  action,
  secondaryActions,
  toolbar,
  children,
  className,
}: BaseProps & { toolbar?: React.ReactNode }) {
  return (
    <div className={cn("space-y-6", className)}>
      <PageHeader
        title={title}
        description={description}
        breadcrumb={breadcrumbs ? <Breadcrumbs items={breadcrumbs} /> : undefined}
        action={action}
        secondaryActions={secondaryActions}
      />
      {toolbar ? (
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          {toolbar}
        </div>
      ) : null}
      {children}
    </div>
  );
}

/** Breadcrumb, header, tabs, then the active tab's content. */
export function DetailPage({
  title,
  description,
  breadcrumbs,
  action,
  secondaryActions,
  tabs,
  children,
  className,
}: BaseProps & { tabs?: React.ReactNode }) {
  return (
    <div className={cn("space-y-6", className)}>
      <PageHeader
        title={title}
        description={description}
        breadcrumb={breadcrumbs ? <Breadcrumbs items={breadcrumbs} /> : undefined}
        action={action}
        secondaryActions={secondaryActions}
      />
      {tabs}
      {children}
    </div>
  );
}

/**
 * Header, then stacked sections. Constrained width because settings are read
 * and filled in like a form, not scanned like a dashboard.
 */
export function SettingsPage({
  title,
  description,
  breadcrumbs,
  action,
  children,
  className,
}: BaseProps) {
  return (
    <div className={cn("max-w-3xl space-y-8", className)}>
      <PageHeader
        title={title}
        description={description}
        breadcrumb={breadcrumbs ? <Breadcrumbs items={breadcrumbs} /> : undefined}
        action={action}
      />
      <div className="space-y-10">{children}</div>
    </div>
  );
}
