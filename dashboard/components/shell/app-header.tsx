"use client";

import { Suspense } from "react";
import { SidebarTrigger } from "@/components/ui/sidebar";
import { ThemeToggle } from "@/components/theme-toggle";
import { CompetitionFilter } from "@/components/competition-filter";
import type { CompetitionOption } from "@/lib/data/contracts";

export function AppHeader({
  competitions,
  competitionsUnavailable,
}: {
  competitions: CompetitionOption[];
  competitionsUnavailable: boolean;
}) {
  return (
    <header className="sticky top-0 z-10 flex w-full shrink-0 items-center justify-between gap-3 border-b bg-card px-3 py-2.5 sm:px-6">
      <div className="flex min-w-0 items-center gap-2">
        <SidebarTrigger className="-ml-1" />
        <span className="truncate text-sm font-medium text-muted-foreground">StatsArena</span>
      </div>
      <div className="flex shrink-0 items-center gap-1 sm:gap-2">
        <Suspense fallback={<div className="h-8 w-36 sm:w-52" aria-hidden="true" />}>
          <CompetitionFilter competitions={competitions} unavailable={competitionsUnavailable} />
        </Suspense>
        <ThemeToggle />
      </div>
    </header>
  );
}
