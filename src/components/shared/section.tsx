import { cn } from "@/lib/utils";

/**
 * A titled block within a page. Owns heading level 2, so its children should
 * start at level 3.
 */
export function Section({
  title,
  description,
  action,
  children,
  className,
}: {
  title?: string;
  description?: string;
  action?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <section className={cn("space-y-4", className)}>
      {title || action ? (
        <div className="flex items-end justify-between gap-4">
          <div className="space-y-1">
            {title ? <h2 className="type-h3">{title}</h2> : null}
            {description ? (
              <p className="type-body-sm text-muted-foreground">{description}</p>
            ) : null}
          </div>
          {action ? <div className="shrink-0">{action}</div> : null}
        </div>
      ) : null}
      {children}
    </section>
  );
}
