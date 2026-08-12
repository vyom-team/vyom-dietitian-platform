import type { LucideIcon } from "lucide-react";
import {
  Apple,
  BarChart3,
  CalendarRange,
  CreditCard,
  LayoutDashboard,
  LifeBuoy,
  Settings,
  Users,
} from "lucide-react";

export type NavItem = {
  title: string;
  href: string;
  icon: LucideIcon;
  /** Rendered as a muted pill. Used to mark not-yet-built areas. */
  badge?: string;
};

export type NavSection = {
  /** Omitted for the first group, which needs no heading. */
  title?: string;
  items: NavItem[];
};

/**
 * Practitioner dashboard navigation.
 *
 * Routes exist as placeholder pages so navigation and active states are real
 * and testable. The features behind them are built in later phases.
 */
export const dashboardNav: NavSection[] = [
  {
    items: [
      { title: "Overview", href: "/dashboard", icon: LayoutDashboard },
      { title: "Clients", href: "/clients", icon: Users },
      { title: "Meal Plans", href: "/plans", icon: CalendarRange },
      { title: "Food Database", href: "/foods", icon: Apple },
      { title: "Reports", href: "/reports", icon: BarChart3 },
    ],
  },
  {
    title: "Practice",
    items: [
      { title: "Team", href: "/team", icon: Users },
      { title: "Subscription", href: "/subscription", icon: CreditCard },
      { title: "Settings", href: "/settings", icon: Settings },
    ],
  },
];

export const dashboardFooterNav: NavItem[] = [
  { title: "Help & Support", href: "/support", icon: LifeBuoy },
];

export const marketingNav = [
  { title: "Features", href: "/features" },
  { title: "Pricing", href: "/pricing" },
  { title: "Contact", href: "/contact" },
] as const;

/**
 * Human-readable labels for route segments, used to build breadcrumbs without
 * a per-page lookup table.
 */
export const routeLabels: Record<string, string> = {
  dashboard: "Overview",
  clients: "Clients",
  plans: "Meal Plans",
  foods: "Food Database",
  reports: "Reports",
  team: "Team",
  subscription: "Subscription",
  settings: "Settings",
  support: "Help & Support",
};
