import { BrandMark } from "@/components/layout/brand-mark";
import { ThemeToggle } from "@/components/theme/theme-toggle";
import { SignOutButton } from "@/components/auth/sign-out-button";

/**
 * Onboarding layout — a focused single column, not the application shell.
 *
 * No sidebar and no navigation: there is nothing to navigate to yet, and
 * offering links to areas that will redirect straight back here would be
 * confusing. Sign-out stays available so nobody is trapped.
 *
 * Always dynamic. Access depends on a database read of the user's memberships,
 * which must never be baked into a prerendered response.
 */
export const dynamic = "force-dynamic";

export default function OnboardingLayout({ children }: LayoutProps<"/">) {
  return (
    <div className="flex min-h-svh flex-col">
      <header className="flex h-16 shrink-0 items-center justify-between px-4 sm:px-6">
        <BrandMark />
        <div className="flex items-center gap-1">
          <ThemeToggle />
          <SignOutButton />
        </div>
      </header>

      <main
        id="main-content"
        className="flex flex-1 justify-center px-4 pb-16 sm:px-6"
      >
        <div className="w-full max-w-xl">{children}</div>
      </main>
    </div>
  );
}
