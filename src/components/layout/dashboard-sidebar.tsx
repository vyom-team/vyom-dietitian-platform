import Link from "next/link";

import { BrandMark } from "@/components/layout/brand-mark";
import { DashboardNav } from "@/components/layout/dashboard-nav";
import { ScrollArea } from "@/components/ui/scroll-area";

/**
 * Fixed desktop sidebar. Hidden below `lg`, where navigation moves into the
 * topbar's sheet instead.
 */
export function DashboardSidebar() {
  return (
    <aside className="hidden lg:fixed lg:inset-y-0 lg:left-0 lg:z-40 lg:flex lg:w-60 lg:flex-col lg:border-r lg:bg-sidebar">
      <div className="flex h-14 shrink-0 items-center border-b px-4">
        <Link
          href="/dashboard"
          className="rounded-md outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
        >
          <BrandMark />
          <span className="sr-only">Go to overview</span>
        </Link>
      </div>
      <ScrollArea className="flex-1">
        <div className="p-3">
          <DashboardNav />
        </div>
      </ScrollArea>
    </aside>
  );
}
