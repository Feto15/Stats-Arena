import { DashboardPage } from "@/components/pages/dashboard-page";
import type { DashboardSearchParams } from "@/lib/competition-scope";

export default function TeamsRoute({
  searchParams,
}: {
  searchParams: Promise<DashboardSearchParams>;
}) {
  return <DashboardPage page="teams" searchParams={searchParams} />;
}
