import { DashboardSidebar } from "@/components/layout/dashboard-sidebar";
import { DashboardTopbar } from "@/components/layout/dashboard-topbar";
import { requireAuth } from "@/lib/auth/dal";

/**
 * Practitioner dashboard layout.
 *
 * `requireAuth()` here is the real access check. `proxy.ts` also redirects
 * unauthenticated traffic, but that is an optimistic cookie check and is not
 * the security boundary — this call verifies the token with Supabase and
 * resolves the profile, and it runs even if the proxy is bypassed or
 * misconfigured.
 *
 * A Next.js layout does not re-run on every client-side navigation, so each
 * page and action must still authorize its own data access. The Data Access
 * Layer memoises per request, making that cheap.
 */
/**
 * Never prerender anything behind authentication.
 *
 * Normally reading cookies marks a route dynamic automatically, but that signal
 * disappears whenever the auth check short-circuits — for example when Supabase
 * is unconfigured in a build environment. The page would then be statically
 * generated, baking one build-time auth outcome into a response served to every
 * visitor. Stating it explicitly means a misconfigured deploy fails closed
 * rather than silently caching a redirect.
 */
export const dynamic = "force-dynamic";

export default async function DashboardLayout({ children }: LayoutProps<"/">) {
  const user = await requireAuth();

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
        <DashboardTopbar
          userName={user.fullName ?? user.email}
          userEmail={user.email}
          organizationName={user.memberships[0]?.organizationName}
          role={user.memberships[0]?.role}
        />
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
