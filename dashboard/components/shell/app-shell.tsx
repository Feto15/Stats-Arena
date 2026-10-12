import { AppHeader } from "./app-header";
import { AppSidebar } from "./app-sidebar";
import { SidebarProvider } from "@/components/ui/sidebar";
import type { CompetitionOption } from "@/lib/data/contracts";

export function AppShell({
  children,
  competitions,
  competitionsUnavailable,
}: {
  children: React.ReactNode;
  competitions: CompetitionOption[];
  competitionsUnavailable: boolean;
}) {
  // Hydrate the sidebar with its provider before mobile detection changes the layout.
  return (
    <SidebarProvider className="bg-sidebar">
      <AppSidebar />
      <div className="h-svh w-full overflow-hidden lg:p-2">
        <div className="flex h-full w-full flex-col overflow-hidden bg-background lg:rounded-lg lg:border">
          <a
            href="#main-content"
            className="sr-only z-50 rounded-md bg-background px-3 py-2 text-sm font-medium focus:not-sr-only focus:absolute focus:left-4 focus:top-3"
          >
            Lewati ke konten
          </a>
          <AppHeader competitions={competitions} competitionsUnavailable={competitionsUnavailable} />
          <main id="main-content" className="w-full flex-1 overflow-auto" tabIndex={-1}>
            {children}
          </main>
        </div>
      </div>
    </SidebarProvider>
  );
}
