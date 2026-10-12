import { DetailFailure, DetailMissing, DetailNoCompetition, GameDetailView } from "@/components/pages/detail-views";
import { parseCompetitionFilter, type DashboardSearchParams } from "@/lib/competition-scope";
import { parseGameDetailFilters } from "@/lib/data/queries";
import { readCompetition, readGame } from "@/lib/data/server";

export default async function GameDetailRoute({
  params,
  searchParams,
}: {
  params: Promise<{ gameId: string }>;
  searchParams: Promise<DashboardSearchParams>;
}) {
  const [{ gameId }, query] = await Promise.all([params, searchParams]);
  const selected = parseCompetitionFilter(query["competition"]);
  if (selected.status !== "selected") return <div className="space-y-4 p-4 sm:p-6"><DetailNoCompetition backHref="/games" /></div>;
  const competition = await readCompetition(selected.sourceCompetitionId);
  if (competition.status === "unavailable") return <div className="space-y-4 p-4 sm:p-6"><DetailFailure message={competition.message} /></div>;
  if (!competition.data) return <div className="space-y-4 p-4 sm:p-6"><DetailMissing entity="Kompetisi" backHref="/games" /></div>;
  const filters = parseGameDetailFilters(query);
  const game = await readGame(competition.data.id, gameId, filters);
  if (game.status === "error") return <div className="space-y-4 p-4 sm:p-6"><DetailFailure message={game.message} /></div>;
  if (!game.data) return <div className="space-y-4 p-4 sm:p-6"><DetailMissing entity="Pertandingan" backHref={`/games?competition=${encodeURIComponent(selected.sourceCompetitionId)}`} /></div>;
  return <div className="space-y-4 p-4 sm:p-6"><GameDetailView game={game.data} params={query} filters={filters} /></div>;
}
