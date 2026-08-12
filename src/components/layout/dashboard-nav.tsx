"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

import {
  dashboardFooterNav,
  dashboardNav,
  type NavItem,
} from "@/config/navigation";
import { cn } from "@/lib/utils";

/**
 * Marks a nav item active for its own route and any nested route beneath it,
 * so `/clients/abc` still highlights "Clients". `/dashboard` matches exactly to
 * avoid it staying lit everywhere.
 */
function isActive(pathname: string, href: string) {
  if (href === "/dashboard") return pathname === href;
  return pathname === href || pathname.startsWith(`${href}/`);
}

function NavLink({
  item,
  active,
  onNavigate,
}: {
  item: NavItem;
  active: boolean;
  onNavigate?: () => void;
}) {
  return (
    <Link
      href={item.href}
      onClick={onNavigate}
      aria-current={active ? "page" : undefined}
      className={cn(
        "group flex items-center gap-2.5 rounded-md px-2.5 py-2 text-sm transition-colors",
        "outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50",
        active
          ? "bg-sidebar-accent font-medium text-sidebar-accent-foreground"
          : "text-muted-foreground hover:bg-sidebar-accent/60 hover:text-foreground",
      )}
    >
      <item.icon
        className={cn(
          "size-4 shrink-0",
          active ? "text-primary" : "text-muted-foreground/80",
        )}
        aria-hidden="true"
      />
      <span className="truncate">{item.title}</span>
      {item.badge ? (
        <span className="type-caption ml-auto rounded border px-1.5 py-0.5">
          {item.badge}
        </span>
      ) : null}
    </Link>
  );
}

export function DashboardNav({
  onNavigate,
  label = "Main",
}: {
  onNavigate?: () => void;
  /**
   * Distinguishes the sidebar from the mobile sheet copy. Two landmarks sharing
   * one name is ambiguous when navigating by landmark in a screen reader.
   */
  label?: string;
}) {
  const pathname = usePathname();

  return (
    <nav aria-label={label} className="flex h-full flex-col gap-6">
      <div className="flex-1 space-y-6">
        {dashboardNav.map((section, index) => (
          <div key={section.title ?? index} className="space-y-1">
            {section.title ? (
              <p className="type-caption px-2.5 pb-1 font-medium tracking-wide uppercase">
                {section.title}
              </p>
            ) : null}
            {section.items.map((item) => (
              <NavLink
                key={item.href}
                item={item}
                active={isActive(pathname, item.href)}
                onNavigate={onNavigate}
              />
            ))}
          </div>
        ))}
      </div>

      <div className="space-y-1 border-t pt-4">
        {dashboardFooterNav.map((item) => (
          <NavLink
            key={item.href}
            item={item}
            active={isActive(pathname, item.href)}
            onNavigate={onNavigate}
          />
        ))}
      </div>
    </nav>
  );
}
