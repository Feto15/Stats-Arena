"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import {
  CalendarRange,
  ClipboardCheck,
  LayoutDashboard,
  Shield,
  Trophy,
  Users,
} from "lucide-react";
import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  useSidebar,
} from "@/components/ui/sidebar";

const navigation = [
  { title: "Overview", href: "/", icon: LayoutDashboard },
  { title: "Games", href: "/games", icon: CalendarRange },
  { title: "Teams", href: "/teams", icon: Shield },
  { title: "Players", href: "/players", icon: Users },
  { title: "Standings", href: "/standings", icon: Trophy },
  { title: "Review", href: "/review", icon: ClipboardCheck },
] as const;

function withCompetition(path: string, competitionValues: readonly string[]): string {
  if (competitionValues.length === 0) return path;
  const query = new URLSearchParams();
  // Preserve repeated values so navigation cannot turn an invalid scope into a selection.
  for (const value of competitionValues) query.append("competition", value);
  return `${path}?${query.toString()}`;
}

export function AppSidebar() {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const { isMobile, setOpenMobile } = useSidebar();
  const competition = searchParams.getAll("competition");

  return (
    <Sidebar collapsible="offcanvas" className="!border-r-0">
      <SidebarHeader className="px-3 py-4">
        <Link
          href={withCompetition("/", competition)}
          className="flex items-center gap-2 outline-none focus-visible:ring-2 focus-visible:ring-sidebar-ring"
        >
          <span className="flex size-8 shrink-0 items-center justify-center rounded-md bg-primary text-primary-foreground">
            <Trophy className="size-4" aria-hidden="true" />
          </span>
          <span className="flex min-w-0 flex-col leading-tight">
            <span className="truncate font-semibold text-sidebar-foreground">StatsArena</span>
            <span className="truncate text-[11px] text-muted-foreground">Basketball Analytics</span>
          </span>
        </Link>
      </SidebarHeader>

      <SidebarContent className="px-2">
        <SidebarGroup className="p-0">
          <SidebarGroupLabel>Navigasi</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {navigation.map((item) => {
                const active = item.href === "/"
                  ? pathname === "/"
                  : pathname === item.href || pathname.startsWith(`${item.href}/`);

                return (
                  <SidebarMenuItem key={item.href}>
                    <SidebarMenuButton asChild isActive={active} className="h-9">
                      <Link
                        href={withCompetition(item.href, competition)}
                        aria-current={active ? "page" : undefined}
                        onClick={() => {
                          if (isMobile) setOpenMobile(false);
                        }}
                      >
                        <item.icon className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
                        <span className="text-sm">{item.title}</span>
                      </Link>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                );
              })}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>
    </Sidebar>
  );
}
