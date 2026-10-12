import { DashboardPage } from "@/components/pages/dashboard-page";
import type { DashboardSearchParams } from "@/lib/competition-scope";

export default function ReviewRoute({
  searchParams,
}: {
  searchParams: Promise<DashboardSearchParams>;
}) {
  return <DashboardPage page="review" searchParams={searchParams} />;
}
