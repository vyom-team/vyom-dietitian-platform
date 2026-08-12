import Link from "next/link";

import { BrandMark } from "@/components/layout/brand-mark";

/**
 * Authentication layout: a single centred column, no navigation.
 *
 * Removing the surrounding chrome keeps focus on the one task, and there is no
 * signed-in state to navigate with anyway.
 */
export default function AuthLayout({ children }: LayoutProps<"/">) {
  return (
    <div className="flex min-h-svh flex-col">
      <header className="flex h-16 items-center px-6">
        <Link
          href="/"
          className="rounded-md outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
        >
          <BrandMark />
          <span className="sr-only">Vyom home</span>
        </Link>
      </header>

      <main className="flex flex-1 items-center justify-center px-4 py-10">
        <div className="w-full max-w-sm">{children}</div>
      </main>

      <footer className="px-6 py-6">
        <p className="type-caption text-center">
          Authentication is implemented in a later phase. These screens are
          layout only.
        </p>
      </footer>
    </div>
  );
}
