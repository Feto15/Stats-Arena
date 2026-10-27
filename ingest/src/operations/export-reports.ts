import { createHash } from "node:crypto";
import { lstat, mkdir, readFile, realpath, rename, writeFile } from "node:fs/promises";
import { basename, dirname, resolve, sep } from "node:path";
import { gunzipSync } from "node:zlib";
import { pathToFileURL } from "node:url";
import { z } from "zod";
import { BASE_STAT_FIELDS } from "@statsarena/db/analytics";
import { competitionReference } from "@statsarena/db/source";
import { liveStatsPlayerNameEvidence } from "@statsarena/db/livestats";
import { boxScoreSchema, competitionSchema, gameSchema, playByPlayEventSchema, shotSchema, teamSchema } from "../domain/types.js";
import { coreFields, parseLiveStatsJson } from "../livestats/parser.js";
import { LIVESTATS_VERSION } from "../livestats/source.js";

const provenance = z.object({ auditPath: z.string(), auditCreatedAt: z.string(), parserVersion: z.string(), sha256: z.string().nullable() });
const analysisSchema = z.object({ format: z.literal("statsarena-analysis"), generatedAt: z.string(), competition: competitionSchema,
  scope: z.object({ competitionKey: z.string(), latestFixtureIds: z.array(z.string()), includedGameIds: z.array(z.string()), fixtureDiscoveryComplete: z.boolean() }),
  games: z.array(z.object({ fixture: gameSchema, boxScore: boxScoreSchema.nullable(), source: provenance.nullable(), includedInAggregates: z.boolean() })) });
const auditSchema = z.object({ parserVersion: z.string(), createdAt: z.string(), data: z.object({ competition: competitionSchema, teams: z.array(teamSchema), matches: z.array(z.object({ fixture: gameSchema,
  playByPlay: z.object({ status: z.string(), records: z.array(playByPlayEventSchema) }).nullish(), shotChart: z.object({ status: z.string(), records: z.array(shotSchema) }).nullish() })) }),
  fetches: z.array(z.object({ resource: z.string(), requestUrl: z.string(), sha256: z.string().nullable(), fetchedAt: z.string(), sourceFetchedAt: z.string().optional(), parseStatus: z.string().optional() })) });
const liveSchema = z.object({ tm: z.record(z.string(), z.object({ pl: z.record(z.string(), z.record(z.string(), z.unknown())) })), pbp: z.array(z.record(z.string(), z.unknown())) });
async function json(path: string): Promise<unknown> {
  const info = await lstat(path);
  if (!info.isFile() || info.isSymbolicLink() || info.size > 128 * 1024 * 1024) throw new Error("Invalid or oversized local report source.");
  return JSON.parse(await readFile(path, "utf8")) as unknown;
}
function localPath(root: string, value: string) {
  const path = resolve(root, value);
  if (!path.startsWith(`${resolve(root)}${sep}`)) throw new Error("Report source path is outside its allowed directory.");
  return path;
}

/** Offline export only: never fetches the network, loads environment credentials, or writes Neon. */
export async function exportLocalReports(repoRoot: string, input: string) {
  const reference = competitionReference(input);
  if (reference.namespace !== "IBL") throw new Error("The club reporting export currently supports the IBL namespace.");
  const root = resolve(repoRoot);
  const analysis = analysisSchema.parse(await json(resolve(root, `ingest/audit/analysis/IBL-${reference.id}.json`)));
  if (analysis.scope.competitionKey !== `IBL:${reference.id}` || analysis.competition.sourceUrl !== reference.url) throw new Error("Analysis competition scope mismatch.");
  const catalog = z.object({ competitions: z.array(z.object({ id: z.string(), sourceUrl: z.string(), latestAuditFile: z.string(), liveStatsFiles: z.record(z.string(), z.string()).default({}) })) }).parse(await json(resolve(root, "ingest/config/competitions_catalog.json")));
  const entry = catalog.competitions.find(c => c.id === reference.id && c.sourceUrl === reference.url);
  if (!entry) throw new Error("Local competition catalog entry not found.");
  const auditRoot = resolve(root, "ingest/audit");
  const readAudit = async (name: string) => {
    if (basename(name) !== name || !name.startsWith(`IBL:${reference.id}-`) || !name.endsWith(".json")) throw new Error("Invalid audit reference.");
    const audit = auditSchema.parse(await json(localPath(auditRoot, name)));
    if (audit.data.competition.sourceUrl !== reference.url) throw new Error("Cross-competition audit rejected.");
    return audit;
  };
  const latest = await readAudit(entry.latestAuditFile);
  const order = analysis.scope.latestFixtureIds;
  if (new Set(order).size !== order.length || order.length !== analysis.games.length || analysis.games.some(g => !order.includes(g.fixture.sourceId))) throw new Error("Fixture ordering scope is incomplete.");
  const fixtures = [...analysis.games].sort((a, b) => order.indexOf(a.fixture.sourceId) - order.indexOf(b.fixture.sourceId)).map(g => g.fixture);
  const seenSlugs = new Set<string>();
  const clubs = latest.data.teams.map(team => {
    if (!new URL(team.sourceUrl).pathname.startsWith(`/IBL/en/competition/${reference.id}/team/${team.sourceId}/`)) throw new Error("Invalid club source scope.");
    let slug = team.name.normalize("NFKD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || `club-${team.sourceId}`;
    if (seenSlugs.has(slug)) slug = `${slug}-${team.sourceId}`;
    seenSlugs.add(slug);
    return { ...team, slug };
  }).sort((a, b) => a.name.localeCompare(b.name));
  if (new Set(clubs.map(c => c.sourceId)).size !== clubs.length || fixtures.some(f => !clubs.some(c => c.sourceId === f.homeTeamSourceId) || !clubs.some(c => c.sourceId === f.awayTeamSourceId))) throw new Error("Fixture/club identities do not reconcile.");
  const games = [];
  for (const fixture of fixtures) {
    const observation = analysis.games.find(g => g.fixture.sourceId === fixture.sourceId)!;
    if (!observation.includedInAggregates) continue;
    const box = observation.boxScore;
    const source = observation.source;
    if (!box || !source || fixture.status !== "complete") throw new Error("Included report game lacks a valid completed box score.");
    const auditFile = basename(source.auditPath);
    const audit = await readAudit(auditFile);
    const match = audit.data.matches.find(g => g.fixture.sourceId === fixture.sourceId);
    if (!match) throw new Error("Game missing from source audit.");
    const resources = audit.fetches.filter(f => f.sha256 && f.parseStatus === "parsed" && new URL(f.requestUrl).pathname.startsWith(`/IBL/en/competition/${reference.id}/match/${fixture.sourceId}/`)).map(f => ({ resource: f.resource, sourceUrl: f.requestUrl, fetchedAt: f.sourceFetchedAt ?? f.fetchedAt, sha256: f.sha256!, parseStatus: "parsed" }));
    const boxResource = resources.find(r => r.resource === "boxscore" && r.sha256 === source.sha256);
    if (!boxResource) throw new Error("Analysis box score hash has no matching audit resource.");
    const stats = (row: z.infer<typeof boxScoreSchema>["players"][number] | z.infer<typeof boxScoreSchema>["teams"][number]) => Object.fromEntries(BASE_STAT_FIELDS.map(field => [field, row[field]]));
    const portal = { competition: { key: analysis.scope.competitionKey, name: analysis.competition.name, sourceUrl: analysis.competition.sourceUrl }, fixture,
      teams: box.teams.map(t => ({ sourceId: t.teamSourceId, name: t.teamName, stats: stats(t), statDerivations: t.statDerivations })),
      players: box.players.map(p => ({ sourceId: p.playerSourceId, name: p.playerName, teamSourceId: p.teamSourceId, jerseyNumber: p.jerseyNumber, minutesRaw: p.minutesRaw, stats: stats(p), statDerivations: p.statDerivations })),
      periodEnds: match.playByPlay?.status === "parsed" ? match.playByPlay.records.filter(e => e.actionType === "period" && e.actionText === "Period end" && e.periodNumber !== null).map(e => ({ period: e.periodNumber, sourceSequence: e.sourceSequence, homeScore: e.team1Score, awayScore: e.team2Score })) : [],
      provenance: { auditFile, auditCreatedAt: audit.createdAt, parserVersion: audit.parserVersion, resources } };
    const shotResource = resources.find(r => r.resource === "shotchart");
    const shots = shotResource && match.shotChart?.status === "parsed" ? { gameSourceId: fixture.sourceId, sourceUrl: shotResource.sourceUrl, sha256: shotResource.sha256, fetchedAt: shotResource.fetchedAt, parserVersion: audit.parserVersion, status: "parsed", shots: match.shotChart.records } : null;
    let rotation: unknown = null;
    let rotationIssues: string[] = [];
    const cached = entry.liveStatsFiles[fixture.sourceId];
    if (cached) {
      const snapshots = resolve(root, "ingest/snapshots/livestats");
      const path = localPath(snapshots, resolve(root, cached));
      if (!(await realpath(path)).startsWith(`${await realpath(snapshots)}${sep}`)) throw new Error("LiveStats snapshot escaped its directory.");
      const info = await lstat(path);
      if (!info.isFile() || info.isSymbolicLink() || info.size > 16 * 1024 * 1024) throw new Error("Invalid LiveStats snapshot.");
      const envelope = z.object({ url: z.string(), body: z.string().max(32 * 1024 * 1024), hash: z.string(), fetchedAt: z.string() }).parse(JSON.parse(gunzipSync(await readFile(path), { maxOutputLength: 40 * 1024 * 1024 }).toString("utf8")) as unknown);
      if (envelope.url !== `https://fibalivestats.dcd.shared.geniussports.com/data/${fixture.sourceId}/data.json` || createHash("sha256").update(envelope.body).digest("hex") !== envelope.hash) throw new Error("LiveStats identity/hash mismatch.");
      const raw: unknown = JSON.parse(envelope.body);
      const live = liveSchema.parse(raw);
      const mapped = parseLiveStatsJson(raw, { gameId: fixture.sourceId, sourceGameId: fixture.sourceId, competitionUrl: reference.url, homeTeamId: fixture.homeTeamSourceId, awayTeamId: fixture.awayTeamSourceId, homeScore: fixture.homeScore, awayScore: fixture.awayScore, status: fixture.status,
        teams: box.teams.map(t => ({ ...t, teamId: t.teamSourceId, name: t.teamName })), players: box.players.map(p => ({ ...p, playerId: p.playerSourceId, teamId: p.teamSourceId, name: p.playerName })) });
      rotationIssues = mapped.issues.map(i => `${i.code}: ${i.message}`);
      const events = live.pbp.map((e, sourceSequence) => ({ sourceSequence, ...Object.fromEntries(["clock", "period", "periodType", "tno", "pno", "player", "shirtNumber", "actionType", "subType", "actionNumber", "previousAction", "qualifier", "scoring", "s1", "s2", "success", "gt"].map(key => [key, e[key]])) }));
      rotation = { gameId: fixture.sourceId, periodCount: 4, periodSeconds: 600, homeScore: fixture.homeScore, awayScore: fixture.awayScore, events,
        teams: ["1", "2"].map(key => ({ teamSourceId: key === "1" ? fixture.homeTeamSourceId : fixture.awayTeamSourceId, clubLocalTeamKey: Number(key), players: (mapped.payload?.players ?? []).filter(p => p.localTeamKey === key).map(p => {
          const pl = live.tm[key]!.pl[p.localPlayerKey]!;
          return { sourceId: p.playerId, localKey: Number(p.localPlayerKey), name: p.name, nameEvidence: liveStatsPlayerNameEvidence(pl), jerseyNumber: p.jerseyNumber, starter: p.starter, minutesRaw: pl["sMinutes"], plusMinus: p.plusMinus, mappingMethod: p.mappingMethod, core: Object.fromEntries(Object.entries(coreFields).map(([field, sourceKey]) => [field, pl[sourceKey]])) };
        }) })), source: { jsonUrl: envelope.url, pageUrl: `https://fibalivestats.dcd.shared.geniussports.com/u/IBL/${fixture.sourceId}/bs.html`, sha256: envelope.hash, fetchedAt: envelope.fetchedAt, adapterVersion: LIVESTATS_VERSION, portalAuditFile: auditFile, boxscoreSha256: boxResource.sha256 } };
    }
    games.push({ portal, shots, rotation, rotationIssues });
  }
  const result = { format: "statsarena-local-reports/1.0.0", competition: { key: analysis.scope.competitionKey, name: analysis.competition.name, sourceUrl: analysis.competition.sourceUrl }, exportedFrom: { analysisFile: `IBL-${reference.id}.json`, generatedAt: analysis.generatedAt, latestAuditFile: entry.latestAuditFile, fixtureDiscoveryComplete: analysis.scope.fixtureDiscoveryComplete }, clubs, fixtures, games };
  const output = resolve(root, `dashboard/lib/reports/data/IBL-${reference.id}.json`);
  await mkdir(dirname(output), { recursive: true });
  await writeFile(`${output}.tmp`, JSON.stringify(result) + "\n");
  await rename(`${output}.tmp`, output);
  const manifest = resolve(dirname(output), "report-routes.json");
  await writeFile(`${manifest}.tmp`, JSON.stringify({ competitionKey: result.competition.key, clubSlugs: clubs.map(c => c.slug) }, null, 2) + "\n");
  await rename(`${manifest}.tmp`, manifest);
  return { output, competition: result.competition, clubs: clubs.length, completedGames: games.length, fixtures: fixtures.length };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const args = process.argv.slice(2);
  if (args.includes("--help")) console.log("Offline report export: node --import tsx src/operations/export-reports.ts --competition IBL:<ID>\nReads existing catalog/analysis/audits/LiveStats caches; writes dashboard/lib/reports/data/IBL-<ID>.json. No network or Neon.");
  else {
    if (args[0] !== "--competition" || !args[1] || args.length !== 2) throw new Error("Use --help for offline report export usage.");
    console.log(JSON.stringify(await exportLocalReports(resolve(process.cwd(), ".."), args[1]), null, 2));
  }
}
