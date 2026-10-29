import { and, asc, eq, inArray } from "drizzle-orm";
import { authUsers, competitions, competitionTeams, teams } from "@statsarena/db";
import { competitionReference, SOURCE_NAMES } from "@statsarena/db/source";
import type { AuthDatabase } from "./factory";

/** The admin UI and invitation action share the same Neon-backed source of grant choices. */
export async function readGrantChoices(db: AuthDatabase, actorId: string, input: string) {
  const [actor] = await db.select({ isAdmin: authUsers.isAdmin }).from(authUsers).where(eq(authUsers.id, actorId)).limit(1);
  if (!actor?.isAdmin) throw new Error("Akses admin diperlukan.");
  const ref = competitionReference(input);
  const rows = await db.select({ id: competitions.id, source: competitions.source, sourceId: competitions.sourceCompetitionId, name: competitions.name }).from(competitions)
    .where(inArray(competitions.source, Object.values(SOURCE_NAMES))).orderBy(asc(competitions.name)).limit(5001);
  if (rows.length > 5000) throw new Error("Daftar kompetisi melampaui batas layanan.");
  const selected = rows.find(c => c.source === ref.source && c.sourceId === ref.id);
  if (!selected) throw new Error("Kompetisi belum tersedia.");
  const clubs = await db.select({ sourceId: teams.sourceTeamId, name: teams.name }).from(competitionTeams).innerJoin(teams, eq(teams.id, competitionTeams.teamId))
    .where(and(eq(competitionTeams.competitionId, selected.id), eq(teams.source, ref.source))).orderBy(asc(teams.name)).limit(1001);
  if (clubs.length > 1000) throw new Error("Daftar klub melampaui batas layanan.");
  return { competitionKey: ref.key, competitions: rows.map(c => ({ key: c.source === SOURCE_NAMES.IBL ? `IBL:${c.sourceId}` : c.sourceId, name: c.name })), clubs };
}
