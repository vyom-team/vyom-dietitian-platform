import { AppFooter } from "@/components/layout/app-footer";
import { AppHeader } from "@/components/layout/app-header";

/**
 * Outer application frame: header, main region, footer.
 *
 * Sidebar navigation is intentionally absent — it belongs with the
 * authenticated practitioner area in a later phase.
 */
export function AppShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-svh flex-col">
      <AppHeader />
      <main className="flex-1 py-10 sm:py-14">{children}</main>
      <AppFooter />
    </div>
  );
}
