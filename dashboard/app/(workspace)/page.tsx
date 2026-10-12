import { DashboardPage } from "@/components/pages/dashboard-page";
import type { DashboardSearchParams } from "@/lib/competition-scope";

export default function OverviewRoute({
  searchParams,
}: {
  searchParams: Promise<DashboardSearchParams>;
}) {
  return <DashboardPage page="overview" searchParams={searchParams} />;
}
