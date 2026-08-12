import Link from "next/link";

/**
 * Shared frame for the authentication screens so all four share one layout,
 * heading level, and footer treatment.
 */
export function AuthCard({
  title,
  description,
  children,
  footer,
}: {
  title: string;
  description: string;
  children: React.ReactNode;
  footer?: React.ReactNode;
}) {
  return (
    <div className="space-y-6">
      <div className="space-y-1.5">
        <h1 className="type-h2">{title}</h1>
        <p className="type-body text-muted-foreground">{description}</p>
      </div>
      <div className="rounded-xl border bg-card p-6">{children}</div>
      {footer ? <div className="type-body-sm text-center">{footer}</div> : null}
    </div>
  );
}

export function AuthLink({
  href,
  children,
}: {
  href: string;
  children: React.ReactNode;
}) {
  return (
    <Link
      href={href}
      className="rounded-sm font-medium text-primary underline-offset-4 outline-none hover:underline focus-visible:ring-[3px] focus-visible:ring-ring/50"
    >
      {children}
    </Link>
  );
}
