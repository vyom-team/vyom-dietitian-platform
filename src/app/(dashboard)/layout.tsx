import { DashboardSidebar } from "@/components/layout/dashboard-sidebar";
import { DashboardTopbar } from "@/components/layout/dashboard-topbar";

/**
 * Practitioner dashboard layout: fixed sidebar on desktop, sheet navigation
 * below `lg`, sticky topbar throughout.
 *
 * No authentication guard yet — that is added when auth exists.
 */
export default function DashboardLayout({ children }: LayoutProps<"/">) {
  return (
    <div className="min-h-svh">
      <a
        href="#main-content"
        className="sr-only rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground focus:not-sr-only focus:absolute focus:top-3 focus:left-3 focus:z-50"
      >
        Skip to content
      </a>

      <DashboardSidebar />

      <div className="lg:pl-60">
        <DashboardTopbar />
        <main
          id="main-content"
          tabIndex={-1}
          className="px-4 py-6 outline-none sm:px-6 sm:py-8"
        >
          <div className="mx-auto w-full max-w-7xl">{children}</div>
        </main>
      </div>
    </div>
  );
}
