import { DashboardPage } from "@/components/pages/dashboard-page";
import type { DashboardSearchParams } from "@/lib/competition-scope";

export default function StandingsRoute({
  searchParams,
}: {
  searchParams: Promise<DashboardSearchParams>;
}) {
  return <DashboardPage page="standings" searchParams={searchParams} />;
}
