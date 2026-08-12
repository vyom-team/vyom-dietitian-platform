"use client";

import { useState } from "react";
import { usePathname } from "next/navigation";
import { Bell, LogOut, Menu, Search } from "lucide-react";

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
import { signOut } from "@/lib/auth/actions";
import { ROLE_LABELS } from "@/lib/auth/roles";
import type { OrganizationRole } from "@/generated/prisma/enums";

/** Derives the page title from the first path segment. */
function usePageTitle() {
  const pathname = usePathname();
  const segment = pathname.split("/").filter(Boolean)[0];
  return (segment && routeLabels[segment]) ?? "Overview";
}

function initialsFrom(name: string): string {
  const parts = name.trim().split(/\s+/).slice(0, 2);
  const letters = parts.map((part) => part[0] ?? "").join("");
  return (letters || name.slice(0, 2)).toUpperCase();
}

export function DashboardTopbar({
  userName,
  userEmail,
  organizationName,
  role,
}: {
  userName: string;
  userEmail: string;
  organizationName?: string;
  role?: OrganizationRole;
}) {
  const [open, setOpen] = useState(false);
  const title = usePageTitle();

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
            <DashboardNav label="Mobile" onNavigate={() => setOpen(false)} />
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
                <AvatarFallback className="text-xs">
                  {initialsFrom(userName)}
                </AvatarFallback>
              </Avatar>
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-60">
            <DropdownMenuLabel className="font-normal">
              <p className="truncate text-sm font-medium">{userName}</p>
              <p className="type-caption truncate">{userEmail}</p>
              {organizationName ? (
                <p className="type-caption mt-1 truncate">
                  {organizationName}
                  {role ? ` · ${ROLE_LABELS[role]}` : ""}
                </p>
              ) : null}
            </DropdownMenuLabel>
            <DropdownMenuSeparator />
            <DropdownMenuItem disabled>Profile</DropdownMenuItem>
            <DropdownMenuItem disabled>Practice settings</DropdownMenuItem>
            <DropdownMenuSeparator />
            {/*
              Sign-out is a form posting to a Server Action, not a client-side
              fetch: it must clear the httpOnly session cookie, which only the
              server can do.
            */}
            <form action={signOut}>
              <button
                type="submit"
                className="relative flex w-full cursor-default items-center gap-2 rounded-sm px-2 py-1.5 text-sm outline-none select-none hover:bg-accent hover:text-accent-foreground focus-visible:bg-accent"
              >
                <LogOut className="size-4" aria-hidden="true" />
                Sign out
              </button>
            </form>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </header>
  );
}
