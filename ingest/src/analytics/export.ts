import { randomUUID } from "node:crypto";
import { lstat, mkdir, readFile, readdir, realpath, rename, unlink, writeFile } from "node:fs/promises";
import { basename, dirname, join, relative, resolve, sep } from "node:path";
import { z } from "zod";
import { ANALYTICS_VERSION, BASE_STAT_FIELDS, calculateMetrics, contextualInputs, metricDefinitions, PLAYER_METRICS, sumStats, TEAM_METRICS, type Stats } from "@statsarena/db/analytics";
import { boxScoreSchema, competitionSchema, gameSchema, type BoxScoreRecord, type CompetitionRecord, type GameRecord } from "../domain/types.js";
import { boxScoreCompletenessIssues, validateBoxScore } from "../domain/validation.js";
import { competitionReference, sameCompetition, sourceEntityId } from "../domain/source-url.js";
import { acquireDirectoryLock } from "../operations/locks.js";
import { parsedDataHash } from "../domain/content-hash.js";

const MAX_BYTES = 128 * 1024 * 1024;
const provenanceSchema = z.object({ auditPath: z.string(), auditCreatedAt: z.iso.datetime(), parserVersion: z.string(), mode: z.string(), importStatus: z.string().nullable(), sha256: z.string().nullable(), fetchedAt: z.string().nullable() });
const gameInputSchema = z.object({
  fixture: gameSchema, boxScore: boxScoreSchema.nullable(), source: provenanceSchema.nullable(),
  latestAttempt: provenanceSchema, boxScoreStatus: z.enum(["available", "preserved", "unavailable"]),
  problems: z.array(z.string()),
});
type GameInput = z.infer<typeof gameInputSchema>;
type Provenance = z.infer<typeof provenanceSchema>;
const storedSchema = z.object({ format: z.literal("statsarena-analysis"), competition: competitionSchema, generatedAt: z.iso.datetime(), games: z.array(gameInputSchema), scope: z.object({ expectedFixtures: z.number(), latestFixtureIds: z.array(z.string()).nullable(), fixtureObservedAt: z.string().nullable(), fixtureDiscoveryComplete: z.boolean().default(false) }) });
const matchSchema = z.object({ fixture: gameSchema, boxScore: boxScoreSchema.nullable().optional(), availability: z.object({ boxScore: z.string().optional() }).optional() });
const auditSchema = z.object({
  sourceUrl: z.string().optional(), sourceCompetitionId: z.string().optional(), createdAt: z.iso.datetime(),
  parserVersion: z.string().default("unknown"), mode: z.string().default("unknown"),
  imported: z.object({ status: z.string() }).nullable().optional(),
  data: z.object({ competition: competitionSchema, matches: z.array(matchSchema).default([]) }).nullable().optional(),
  changedData: z.record(z.string(), z.unknown()).optional(),
  fixtureObservations: z.array(gameSchema).optional(),
  parseCounts: z.record(z.string(), z.number()).optional(),
  datasetReferences: z.record(z.string(), z.object({ hash: z.string(), file: z.string().optional() })).optional(),
  fetches: z.array(z.object({ requestUrl: z.string(), sha256: z.string().nullable(), fetchedAt: z.string(), sourceFetchedAt: z.string().optional() })).default([]),
});
type Audit = z.infer<typeof auditSchema>;

async function boundedJson(path: string): Promise<unknown> {
  const info = await lstat(path);
  if (!info.isFile() || info.isSymbolicLink() || info.size > MAX_BYTES) throw new Error("JSON analisis/audit harus file biasa berukuran maksimal 128 MiB.");
  return JSON.parse(await readFile(path, "utf8")) as unknown;
}
function object(value: unknown): Record<string, unknown> | null { return value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null; }
function inDirectory(root: string, path: string): boolean {
  const rel = relative(resolve(root), resolve(path));
  return rel !== ".." && !rel.startsWith(`..${sep}`) && !rel.startsWith(sep);
}
async function safeDirectory(root: string, directory: string): Promise<void> {
  if (!inDirectory(root, directory)) throw new Error("Direktori analisis harus berada dalam direktori audit.");
  await mkdir(directory, { recursive: true });
  if (!inDirectory(await realpath(root), await realpath(directory))) throw new Error("Direktori analisis keluar dari direktori audit melalui symlink.");
  if ((await lstat(directory)).isSymbolicLink()) throw new Error("Direktori analisis tidak boleh symlink.");
}
function compactBox(box: BoxScoreRecord): BoxScoreRecord {
  return { ...box, teams: box.teams.map(row => ({ ...row, rawValues: {} })), players: box.players.map(row => ({ ...row, rawValues: {} })) };
}
function compatible(fixture: GameRecord, box: BoxScoreRecord): boolean {
  return box.gameSourceId === fixture.sourceId && [fixture.homeTeamSourceId, fixture.awayTeamSourceId].every((id, index) => {
    const team = box.teams.find(row => row.teamSourceId === id);
    const score = index === 0 ? fixture.homeScore : fixture.awayScore;
    return Boolean(team && (score === null || score === team.points));
  });
}
function validateScope(box: BoxScoreRecord, input: string): void {
  for (const url of [box.sourceUrl, ...box.teams.map(row => row.sourceUrl), ...box.players.map(row => row.sourceUrl)]) {
    if (!sameCompetition(url, input)) throw new Error("Identitas box score lintas kompetisi ditolak oleh ekspor analisis.");
  }
}
function mergeMatch(previous: GameInput | undefined, match: z.infer<typeof matchSchema>, observation: Provenance, input: string): GameInput {
  const { fixture } = match;
  if (!sameCompetition(fixture.sourceUrl, input) || sourceEntityId(fixture.sourceUrl, "match") !== fixture.sourceId) throw new Error("Fixture analisis berbeda namespace/ID.");
  if (previous && previous.latestAttempt.auditCreatedAt > observation.auditCreatedAt) return previous;
  const box = match.boxScore ?? null;
  const problems: string[] = [];
  if (box) {
    validateScope(box, input);
    problems.push(...boxScoreCompletenessIssues(box).map(issue => issue.code));
    problems.push(...validateBoxScore(box, null).map(issue => issue.code));
    if (!compatible(fixture, box)) problems.push("FIXTURE_BOXSCORE_MISMATCH");
    if (previous?.boxScore && previous.boxScore.players.some(old => !box.players.some(row => row.playerSourceId === old.playerSourceId && row.teamSourceId === old.teamSourceId))) problems.push("PREVIOUS_PLAYER_MISSING");
    if (match.availability?.boxScore && match.availability.boxScore !== "available") problems.push(`BOXSCORE_${match.availability.boxScore.toUpperCase()}`);
  } else problems.push("BOXSCORE_UNAVAILABLE");
  if (box && !problems.length) return { fixture, boxScore: compactBox(box), source: observation, latestAttempt: observation, boxScoreStatus: "available", problems: [] };
  const retained = previous?.boxScore && compatible(fixture, previous.boxScore) ? previous : null;
  return { fixture, boxScore: retained?.boxScore ?? null, source: retained?.source ?? null, latestAttempt: observation,
    boxScoreStatus: retained ? "preserved" : "unavailable", problems: [...new Set(problems)] };
}

function minutesForTeam(box: BoxScoreRecord, teamId: string): number | null {
  const players = box.players.filter(row => row.teamSourceId === teamId);
  return sumStats(players).minutes;
}
function teamStats(box: BoxScoreRecord, teamId: string): Stats | undefined {
  const row = box.teams.find(team => team.teamSourceId === teamId);
  return row ? { ...sumStats([row]), minutes: minutesForTeam(box, teamId) } : undefined;
}
function averageStats(stats: Stats, games: number): Stats {
  const result = {} as Stats;
  for (const key of BASE_STAT_FIELDS) result[key] = games > 0 && stats[key] !== null ? stats[key] / games : null;
  return result;
}
export function buildAnalysis(competition: CompetitionRecord, gameInputs: GameInput[], expectedFixtures: number, generatedAt: string, latestFixtureIds: string[] | null = null, fixtureObservedAt: string | null = null, fixtureDiscoveryComplete = false) {
  const eligible = gameInputs.filter(game => game.fixture.status === "complete" && game.boxScore !== null && (!latestFixtureIds || latestFixtureIds.includes(game.fixture.sourceId)));
  const playerSamples = new Map<string, { name: string; teamIds: Set<string>; gameIds: string[]; rows: Stats[]; teams: Partial<Stats>[]; opponents: Partial<Stats>[] }>();
  const teamSamples = new Map<string, { name: string; gameIds: string[]; rows: Stats[]; opponents: Partial<Stats>[] }>();
  const games = gameInputs.map(game => {
    const included = eligible.includes(game);
    const box = included ? game.boxScore : null;
    const teams = (box?.teams ?? []).map(row => {
      const own = teamStats(box!, row.teamSourceId)!;
      const other = box!.teams.find(team => team.teamSourceId !== row.teamSourceId);
      const opponent = other ? teamStats(box!, other.teamSourceId) : undefined;
      const sample = teamSamples.get(row.teamSourceId) ?? { name: row.teamName, gameIds: [], rows: [], opponents: [] };
      sample.gameIds.push(game.fixture.sourceId); sample.rows.push(own); sample.opponents.push(opponent ?? {}); teamSamples.set(row.teamSourceId, sample);
      return { sourceId: row.teamSourceId, name: row.teamName, stats: own, ...calculateMetrics(contextualInputs(own, 1, own, opponent), TEAM_METRICS) };
    });
    const players = (box?.players ?? []).map(row => {
      const own = sumStats([row]);
      const team = teamStats(box!, row.teamSourceId);
      const other = box!.teams.find(candidate => candidate.teamSourceId !== row.teamSourceId);
      const opponent = other ? teamStats(box!, other.teamSourceId) : undefined;
      const sample = playerSamples.get(row.playerSourceId) ?? { name: row.playerName, teamIds: new Set<string>(), gameIds: [], rows: [], teams: [], opponents: [] };
      sample.teamIds.add(row.teamSourceId); sample.gameIds.push(game.fixture.sourceId); sample.rows.push(own); sample.teams.push(team ?? {}); sample.opponents.push(opponent ?? {}); playerSamples.set(row.playerSourceId, sample);
      return { sourceId: row.playerSourceId, name: row.playerName, teamSourceId: row.teamSourceId, jerseyNumber: row.jerseyNumber, stats: own, ...calculateMetrics(contextualInputs(own, 1, team, opponent), PLAYER_METRICS) };
    });
    return { ...game, includedInAggregates: included, exclusionReason: included ? null : latestFixtureIds && !latestFixtureIds.includes(game.fixture.sourceId) ? "not_in_latest_fixtures" : game.fixture.status !== "complete" ? "game_not_complete" : "valid_boxscore_unavailable", teams, players };
  });
  const players = [...playerSamples].sort(([a], [b]) => a.localeCompare(b)).map(([id, sample]) => {
    const totals = sumStats(sample.rows); const gp = sample.gameIds.length;
    return { sourceId: id, name: sample.name, teamSourceIds: [...sample.teamIds].sort(), gameIds: sample.gameIds, gamesPlayed: gp,
      totals, perGame: averageStats(totals, gp), contextTotals: { team: sumStats(sample.teams), opponent: sumStats(sample.opponents) },
      ...calculateMetrics(contextualInputs(totals, gp, sumStats(sample.teams), sumStats(sample.opponents)), PLAYER_METRICS) };
  });
  const teams = [...teamSamples].sort(([a], [b]) => a.localeCompare(b)).map(([id, sample]) => {
    const totals = sumStats(sample.rows); const gp = sample.gameIds.length; const opponent = sumStats(sample.opponents);
    return { sourceId: id, name: sample.name, gameIds: sample.gameIds, gamesPlayed: gp, totals, perGame: averageStats(totals, gp), opponentTotals: opponent,
      ...calculateMetrics(contextualInputs(totals, gp, totals, opponent), TEAM_METRICS) };
  });
  return { format: "statsarena-analysis" as const, analyticsVersion: ANALYTICS_VERSION, generatedAt, competition,
    scope: { competitionKey: competitionReference(competition.sourceUrl).key, aggregation: "complete_games_with_valid_boxscores", expectedFixtures,
      knownFixtures: games.length, includedGameIds: eligible.map(game => game.fixture.sourceId), excludedGameIds: games.filter(game => !game.includedInAggregates).map(game => game.fixture.sourceId),
      preservedGameIds: games.filter(game => game.boxScoreStatus === "preserved").map(game => game.fixture.sourceId),
      latestFixtureIds, fixtureObservedAt, fixtureDiscoveryComplete, fixtureCoverageComplete: fixtureDiscoveryComplete && latestFixtureIds !== null && latestFixtureIds.every(id => games.some(game => game.fixture.sourceId === id)) },
    methodology: { metricDefinitions: metricDefinitions(), teamMinutes: "sum of all player minutes; null if any minute missing", gp: "one included box-score row per player/game; no DNP inferred from zero minutes", ratios: "ratio units are fractions, percent units are 0–100; values are not rounded", playerContext: "team/opponent totals from the same games as the player rows", possessions: "average of both teams' FGA + 0.44*FTA - ORB + TOV; estimate", inputState: "source observations; not proof of a Neon import" },
    games, players, teams };
}

export interface AnalysisExportOptions {
  input: string; auditDirectory: string; auditPath?: string; audit?: unknown;
  fixtures?: readonly GameRecord[]; expectedFixtures?: number; dryRun?: boolean; preview?: boolean;
}

/** Offline export. Caller of sync already owns the competition/snapshot lock. */
export async function exportAnalysis(options: AnalysisExportOptions) {
  const reference = competitionReference(options.input);
  const directory = join(resolve(options.auditDirectory), "analysis");
  await safeDirectory(resolve(options.auditDirectory), directory);
  const baselinePath = join(directory, `${reference.key.replace(":", "-")}.json`);
  const path = options.preview ? baselinePath.replace(/\.json$/, ".preview.json") : baselinePath;
  const lock = await acquireDirectoryLock(join(directory, `.${reference.key.replace(":", "-")}.lock`), randomUUID());
  try {
    let competition: CompetitionRecord | null = null;
    let expected = options.expectedFixtures ?? 0;
    let latestFixtureIds: string[] | null = null;
    let fixtureObservedAt: string | null = null;
    let fixtureDiscoveryComplete = false;
    const inputs = new Map<string, GameInput>();
    let previous = false;
    try {
      const stored = storedSchema.parse(await boundedJson(baselinePath));
      if (competitionReference(stored.competition.sourceUrl).key !== reference.key) throw new Error("File analisis sebelumnya memiliki namespace berbeda.");
      competition = stored.competition;
      expected = Math.max(expected, stored.scope.expectedFixtures);
      latestFixtureIds = stored.scope.latestFixtureIds;
      fixtureObservedAt = stored.scope.fixtureObservedAt;
      fixtureDiscoveryComplete = stored.scope.fixtureDiscoveryComplete;
      for (const game of stored.games) {
        if (!sameCompetition(game.fixture.sourceUrl, reference.url)) throw new Error("Fixture analisis sebelumnya lintas namespace.");
        if (game.boxScore) {
          validateScope(game.boxScore, reference.url);
          if (!compatible(game.fixture, game.boxScore) || boxScoreCompletenessIssues(game.boxScore).length || validateBoxScore(game.boxScore, null).length) throw new Error("Input box score analisis tersimpan tidak valid.");
        }
        inputs.set(game.fixture.sourceId, game);
      }
      previous = true;
    } catch (error) { if (!(error instanceof Error && "code" in error && error.code === "ENOENT")) throw error; }
    const audits = new Map<string, Audit>();
    const rawAudits = new Map<string, Record<string, unknown>>();
    const seen = new Set<string>(); const skipped: string[] = [];
    const observationErrors = new Map<string, unknown>();
    async function observe(file: string, supplied?: unknown): Promise<void> {
      const resolved = resolve(file);
      if (observationErrors.has(resolved)) throw observationErrors.get(resolved);
      if (seen.has(resolved)) return;
      if (seen.size >= 1000 || !inDirectory(options.auditDirectory, resolved) || basename(resolved) !== resolved.split(sep).at(-1)) throw new Error("Referensi audit analisis tidak valid atau melewati batas.");
      seen.add(resolved);
      try {
        if (!inDirectory(await realpath(options.auditDirectory), await realpath(dirname(resolved)))) throw new Error("Referensi audit keluar melalui symlink.");
        const raw = supplied ?? await boundedJson(resolved);
        const audit = auditSchema.parse(raw);
        const url = audit.sourceUrl ?? audit.data?.competition.sourceUrl;
        if (!url || competitionReference(url).key !== reference.key) throw new Error("Audit analisis berbeda kompetisi/namespace.");
        audits.set(resolved, audit);
        rawAudits.set(resolved, object(raw)!);
        for (const [key, ref] of Object.entries(audit.datasetReferences ?? {})) {
          if (!key.startsWith(`${reference.key}:`)) throw new Error("Referensi dataset lintas kompetisi ditolak.");
          if (!ref.file) continue;
          if (ref.file === basename(resolved)) {
            const own = datasetValue(object(raw)!, key);
            if (own === undefined || parsedDataHash(own) !== ref.hash) throw new Error("Hash dataset audit lokal tidak cocok.");
            continue;
          }
          if (basename(ref.file) !== ref.file || ref.file.includes("\\") || !ref.file.endsWith(".json")) throw new Error("Path traversal pada referensi audit ditolak.");
          const next = join(dirname(resolved), ref.file);
          await observe(next);
          const value = resolveDataset(resolve(next), key);
          if (value === undefined || parsedDataHash(value) !== ref.hash) throw new Error("Hash referensi dataset audit tidak cocok.");
        }
      } catch (error) {
        audits.delete(resolved); rawAudits.delete(resolved); observationErrors.set(resolved, error);
        throw error;
      }
    }
    function resolveDataset(file: string, key: string, chain = new Set<string>()): unknown {
      if (chain.has(file) || chain.size > 20) throw new Error("Siklus referensi audit ditolak.");
      chain.add(file);
      const raw = rawAudits.get(file);
      if (!raw) return undefined;
      const own = datasetValue(raw, key);
      if (own !== undefined) return own;
      const ref = audits.get(file)?.datasetReferences?.[key];
      if (!ref?.file || basename(ref.file) !== ref.file || ref.file.includes("\\")) return undefined;
      return resolveDataset(resolve(dirname(file), ref.file), key, chain);
    }
    if (!previous || !options.auditPath) {
      for (const file of (await readdir(options.auditDirectory)).filter(name => name.startsWith(`${reference.key}-`) && name.endsWith(".json") && !name.includes("-livestats-")).sort()) {
        try { await observe(join(options.auditDirectory, file)); }
        catch (error) {
          const path = resolve(options.auditDirectory, file);
          skipped.push(`${file}: ${error instanceof Error ? error.message : "audit invalid"}`);
          observationErrors.set(path, error); audits.delete(path); rawAudits.delete(path);
        }
      }
    }
    if (options.auditPath) await observe(options.auditPath, options.audit);
    if (!audits.size && !previous) throw new Error("Tidak ada payload audit valid untuk kompetisi ini.");
    const ordered = [...audits].sort((a, b) => a[1].createdAt.localeCompare(b[1].createdAt) || a[0].localeCompare(b[0]));
    for (const [auditPath, audit] of ordered) {
      const changes = audit.changedData ?? {};
      const metadata = audit.data?.competition ?? changes[`${reference.key}:competition`];
      if (metadata) {
        const candidate = competitionSchema.parse(metadata);
        if (competitionReference(candidate.sourceUrl).key !== reference.key || candidate.sourceId !== reference.id) throw new Error("Metadata kompetisi analisis tidak cocok.");
        competition = candidate;
      }
      expected = Math.max(expected, audit.parseCounts?.["fixturesDiscovered"] ?? 0);
      const matches = audit.data?.matches ?? Object.entries(changes).filter(([key]) => key.startsWith(`${reference.key}:match:`)).map(([,value]) => matchSchema.parse(value));
      for (const match of matches) {
        const fetch = audit.fetches.filter(row => row.requestUrl === match.boxScore?.sourceUrl).at(-1);
        const observation: Provenance = { auditPath, auditCreatedAt: audit.createdAt, parserVersion: audit.parserVersion, mode: audit.mode,
          importStatus: audit.imported?.status ?? null, sha256: fetch?.sha256 ?? null, fetchedAt: fetch?.sourceFetchedAt ?? fetch?.fetchedAt ?? null };
        inputs.set(match.fixture.sourceId, mergeMatch(inputs.get(match.fixture.sourceId), match, observation, reference.url));
      }
      const fixtures = audit.fixtureObservations ?? (matches.length === audit.parseCounts?.["fixturesDiscovered"] ? matches.map(match => match.fixture) : null);
      if (fixtures && (!fixtureObservedAt || audit.createdAt >= fixtureObservedAt)) {
        fixtureDiscoveryComplete = audit.parseCounts?.["pendingFixturePages"] === 0;
        latestFixtureIds = fixtureDiscoveryComplete ? fixtures.map(fixture => fixture.sourceId) : [...new Set([...inputs.keys(), ...fixtures.map(fixture => fixture.sourceId)])];
        fixtureObservedAt = audit.createdAt;
        for (const fixture of fixtures) updateFixture(fixture, auditPath, audit, inputs, reference.url);
      }
    }
    if (options.fixtures) {
      const last = ordered.at(-1);
      if (last && (!fixtureObservedAt || last[1].createdAt >= fixtureObservedAt)) {
        fixtureDiscoveryComplete = last[1].parseCounts?.["pendingFixturePages"] === 0;
        latestFixtureIds = fixtureDiscoveryComplete ? options.fixtures.map(fixture => fixture.sourceId) : [...new Set([...inputs.keys(), ...options.fixtures.map(fixture => fixture.sourceId)])];
        fixtureObservedAt = last[1].createdAt;
        for (const fixture of options.fixtures) updateFixture(fixture, last[0], last[1], inputs, reference.url);
      }
    }
    if (!competition) throw new Error("Metadata kompetisi lengkap tidak ditemukan; ekspor dibatalkan.");
    const report = { ...buildAnalysis(competition, [...inputs.values()].sort((a,b) => a.fixture.sourceId.localeCompare(b.fixture.sourceId)), expected, new Date().toISOString(), latestFixtureIds, fixtureObservedAt, fixtureDiscoveryComplete), exportMode: options.preview ? "preview" : "analysis" };
    const comparable = (value: unknown): string => { const record = object(value); return JSON.stringify(record ? { ...record, generatedAt: null } : value); };
    let changed = true;
    try { changed = comparable(await boundedJson(path)) !== comparable(report); }
    catch (error) { if (!(error instanceof Error && "code" in error && error.code === "ENOENT")) throw error; }
    if (changed && !options.dryRun) {
      const temporary = `${path}.${randomUUID()}.tmp`;
      try { await writeFile(temporary, `${JSON.stringify(report, null, 2)}\n`, { flag: "wx" }); await lock.assertOwned(); await rename(temporary, path); }
      finally { await unlink(temporary).catch(() => undefined); }
    }
    return { path, changed, dryRun: options.dryRun ?? false, preview: options.preview ?? false, competitionKey: reference.key, analyticsVersion: ANALYTICS_VERSION,
      games: report.games.length, includedGames: report.scope.includedGameIds.length, players: report.players.length, teams: report.teams.length,
      skippedAudits: skipped, fixtureCoverageComplete: report.scope.fixtureCoverageComplete };
  } finally { await lock.release(); }
}
function updateFixture(fixture: GameRecord, auditPath: string, audit: Audit, inputs: Map<string, GameInput>, scope: string): void {
  if (!sameCompetition(fixture.sourceUrl, scope) || sourceEntityId(fixture.sourceUrl, "match") !== fixture.sourceId) throw new Error("Fixture berbeda kompetisi/ID.");
  const observation: Provenance = { auditPath, auditCreatedAt: audit.createdAt, parserVersion: audit.parserVersion, mode: audit.mode, importStatus: audit.imported?.status ?? null, sha256: null, fetchedAt: null };
  const old = inputs.get(fixture.sourceId);
  if (old) {
    if (old.latestAttempt.auditCreatedAt > audit.createdAt) return;
    const latestAttempt = audit.createdAt > old.latestAttempt.auditCreatedAt ? observation : old.latestAttempt;
    if (old.boxScore && !compatible(fixture, old.boxScore)) inputs.set(fixture.sourceId, { ...old, fixture, latestAttempt, boxScore: null, source: null, boxScoreStatus: "unavailable", problems: ["FIXTURE_CHANGED_WITHOUT_VALID_BOX"] });
    else inputs.set(fixture.sourceId, { ...old, fixture, latestAttempt });
  } else {
    inputs.set(fixture.sourceId, { fixture, boxScore: null, source: null, latestAttempt: observation, boxScoreStatus: "unavailable", problems: ["DETAIL_NOT_OBSERVED"] });
  }
}
function datasetValue(audit: Record<string, unknown>, key: string): unknown {
  const changes = object(audit["changedData"]);
  if (changes?.[key] !== undefined) return changes[key];
  const data = object(audit["data"]);
  if (key.includes(":match:")) return Array.isArray(data?.["matches"]) ? data["matches"].find((row: unknown) => object(object(row)?.["fixture"])?.["sourceId"] === key.split(":match:").at(-1)) : undefined;
  const kind = key.split(":").at(-1);
  return kind ? data?.[kind] : undefined;
}
