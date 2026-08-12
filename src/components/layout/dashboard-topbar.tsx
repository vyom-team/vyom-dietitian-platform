"use client";

import { useState } from "react";
import { usePathname } from "next/navigation";
import { Bell, Menu, Search } from "lucide-react";

import { BrandMark } from "@/components/layout/brand-mark";
import { DashboardNav } from "@/components/layout/dashboard-nav";
import { ThemeToggle } from "@/components/theme/theme-toggle";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import { Separator } from "@/components/ui/separator";
import { routeLabels } from "@/config/navigation";

/** Derives the page title from the first path segment. */
function usePageTitle() {
  const pathname = usePathname();
  const segment = pathname.split("/").filter(Boolean)[0];
  return (segment && routeLabels[segment]) ?? "Overview";
}

export function DashboardTopbar() {
  const [open, setOpen] = useState(false);
  const title = usePageTitle();

  // The sheet closes via each nav link's `onNavigate`, so no route-change
  // effect is needed here.
  return (
    <header className="sticky top-0 z-30 flex h-14 items-center gap-3 border-b bg-background/85 px-4 backdrop-blur-sm sm:px-6">
      <Sheet open={open} onOpenChange={setOpen}>
        <SheetTrigger asChild>
          <Button
            variant="ghost"
            size="icon"
            className="lg:hidden"
            aria-label="Open navigation"
          >
            <Menu className="size-4" aria-hidden="true" />
          </Button>
        </SheetTrigger>
        <SheetContent side="left" className="w-72 p-0">
          <SheetHeader className="h-14 justify-center border-b px-4">
            <SheetTitle asChild>
              <BrandMark />
            </SheetTitle>
            <SheetDescription className="sr-only">
              Main navigation
            </SheetDescription>
          </SheetHeader>
          <div className="overflow-y-auto p-3">
            <DashboardNav
              label="Mobile"
              onNavigate={() => setOpen(false)}
            />
          </div>
        </SheetContent>
      </Sheet>

      <p className="type-h4 truncate">{title}</p>

      <div className="ml-auto flex items-center gap-1">
        <Button variant="ghost" size="icon" aria-label="Search">
          <Search className="size-4" aria-hidden="true" />
        </Button>

        <Button variant="ghost" size="icon" aria-label="Notifications">
          <Bell className="size-4" aria-hidden="true" />
        </Button>

        <ThemeToggle />

        <Separator orientation="vertical" className="mx-1 h-6" />

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              className="rounded-full"
              aria-label="Account menu"
            >
              <Avatar className="size-7">
                <AvatarFallback className="text-xs">VY</AvatarFallback>
              </Avatar>
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-56">
            <DropdownMenuLabel className="font-normal">
              <p className="text-sm font-medium">Signed-out preview</p>
              <p className="type-caption">Accounts arrive with authentication</p>
            </DropdownMenuLabel>
            <DropdownMenuSeparator />
            <DropdownMenuItem disabled>Profile</DropdownMenuItem>
            <DropdownMenuItem disabled>Practice settings</DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem disabled>Sign out</DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </header>
  );
}
