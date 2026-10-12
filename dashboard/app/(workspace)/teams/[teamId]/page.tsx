import { DetailFailure, DetailMissing, DetailNoCompetition, TeamDetailView } from "@/components/pages/detail-views";
import { parseCompetitionFilter, type DashboardSearchParams } from "@/lib/competition-scope";
import { readCompetition, readTeam } from "@/lib/data/server";

export default async function TeamDetailRoute({
  params,
  searchParams,
}: {
  params: Promise<{ teamId: string }>;
  searchParams: Promise<DashboardSearchParams>;
}) {
  const [{ teamId }, query] = await Promise.all([params, searchParams]);
  const selected = parseCompetitionFilter(query["competition"]);
  if (selected.status !== "selected") return <div className="space-y-4 p-4 sm:p-6"><DetailNoCompetition backHref="/teams" /></div>;
  const competition = await readCompetition(selected.sourceCompetitionId);
  if (competition.status === "unavailable") return <div className="space-y-4 p-4 sm:p-6"><DetailFailure message={competition.message} /></div>;
  if (!competition.data) return <div className="space-y-4 p-4 sm:p-6"><DetailMissing entity="Kompetisi" backHref="/teams" /></div>;
  const team = await readTeam(competition.data.id, teamId);
  if (team.status === "error") return <div className="space-y-4 p-4 sm:p-6"><DetailFailure message={team.message} /></div>;
  if (!team.data) return <div className="space-y-4 p-4 sm:p-6"><DetailMissing entity="Tim" backHref={`/teams?competition=${encodeURIComponent(selected.sourceCompetitionId)}`} /></div>;
  return <div className="space-y-4 p-4 sm:p-6"><TeamDetailView team={team.data} params={query} /></div>;
}
