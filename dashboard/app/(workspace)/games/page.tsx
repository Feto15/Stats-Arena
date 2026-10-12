import { DashboardPage } from "@/components/pages/dashboard-page";
import type { DashboardSearchParams } from "@/lib/competition-scope";

export default function GamesRoute({
  searchParams,
}: {
  searchParams: Promise<DashboardSearchParams>;
}) {
  return <DashboardPage page="games" searchParams={searchParams} />;
}
