import { DetailFailure, DetailMissing, DetailNoCompetition, PlayerDetailView } from "@/components/pages/detail-views";
import { parseCompetitionFilter, type DashboardSearchParams } from "@/lib/competition-scope";
import { readCompetition, readPlayer } from "@/lib/data/server";

export default async function PlayerDetailRoute({
  params,
  searchParams,
}: {
  params: Promise<{ playerId: string }>;
  searchParams: Promise<DashboardSearchParams>;
}) {
  const [{ playerId }, query] = await Promise.all([params, searchParams]);
  const selected = parseCompetitionFilter(query["competition"]);
  if (selected.status !== "selected") return <div className="space-y-4 p-4 sm:p-6"><DetailNoCompetition backHref="/players" /></div>;
  const competition = await readCompetition(selected.sourceCompetitionId);
  if (competition.status === "unavailable") return <div className="space-y-4 p-4 sm:p-6"><DetailFailure message={competition.message} /></div>;
  if (!competition.data) return <div className="space-y-4 p-4 sm:p-6"><DetailMissing entity="Kompetisi" backHref="/players" /></div>;
  const player = await readPlayer(competition.data.id, playerId);
  if (player.status === "error") return <div className="space-y-4 p-4 sm:p-6"><DetailFailure message={player.message} /></div>;
  if (!player.data) return <div className="space-y-4 p-4 sm:p-6"><DetailMissing entity="Pemain" backHref={`/players?competition=${encodeURIComponent(selected.sourceCompetitionId)}`} /></div>;
  return <div className="space-y-4 p-4 sm:p-6"><PlayerDetailView player={player.data} params={query} /></div>;
}
