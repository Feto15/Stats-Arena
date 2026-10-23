import { buildDetailQuality } from "@statsarena/db/data-quality";
import type { FetchMetadata, FetchResult, PageFetchOptions } from "./fetch/fetcher.js";
import { matchPolicy, pagePolicy } from "./fetch/cache-policy.js";
import { FetchError, HtmlFetcher } from "./fetch/fetcher.js";
import type {
  CompetitionRecord,
  BoxScoreRecord,
  GameRecord,
  GroupStandingsData,
  MatchImportData,
  ParsedCompetitionData,
  ParseReport,
  PageAvailability,
  SummaryRecord,
  ValidationIssue
} from "./domain/types.js";
import { competitionUrl, sourceEntityId, sourceUrlFor } from "./domain/source-url.js";
import { validateBoxScore } from "./domain/validation.js";
import { matchDataStatus } from "./domain/match-status.js";
import { parseBoxScoreHtml } from "./parsers/boxscore.js";
import { fixturePageUrl, parseFixturePageLinksHtml, parseFixturesHtml } from "./parsers/fixtures.js";
import { parsePlayersHtml } from "./parsers/players.js";
import { parseStandingsGroupLinksHtml, parseStandingsHtml } from "./parsers/standings.js";
import { parseSummaryHtml } from "./parsers/summary.js";
import { parseTeamsHtml } from "./parsers/teams.js";
import { parseMatchDetailTabLinksHtml, parseCompetitionStatisticsLinkHtml } from "./parsers/links.js";
import { parsePlayByPlayHtml } from "./parsers/play-by-play.js";
import { parseShotChartHtml } from "./parsers/shot-chart.js";
import { parseTeamAnalysisHtml, parseTeamStatisticsHtml } from "./parsers/official-metrics.js";
import { validateShotsAgainstBoxScore } from "./domain/shot-validation.js";
import { ParserError, issue } from "./parsers/common.js";
import { incrementalReason, type IncrementalReason, type SavedGameSyncState } from "./domain/incremental.js";

export interface PipelineOptions {
  fetcher?: HtmlFetcher;
  snapshotOnly?: boolean;
  matchLimit?: number;
  includeMatches?: boolean;
  forceRefresh?: boolean;
  forceRefreshUrls?: ReadonlySet<string>;
  existingGameIds?: ReadonlySet<string>;
  fixturePageResumeUrls?: readonly string[];
  incrementalGames?: ReadonlyMap<string, SavedGameSyncState>;
}

export interface PipelineResult {
  data: ParsedCompetitionData;
  fetches: FetchMetadata[];
  parseCounts: Record<string, number>;
  pendingFixturePageUrls?: string[];
  fixtureObservations?: GameRecord[];
}

export class PipelineError extends Error {
  constructor(
    message: string,
    readonly sourceUrl: string,
    readonly fetches: FetchMetadata[],
    readonly issues: ValidationIssue[]
  ) {
    super(message);
    this.name = "PipelineError";
  }
}

interface LoadedPage<T> {
  fetch: FetchResult | null;
  report: ParseReport<T> | null;
  issue: ValidationIssue | null;
}

async function loadPage<T>(
  url: string,
  parser: (html: string, sourceUrl: string) => ParseReport<T>,
  fetcher: HtmlFetcher,
  snapshotOnly: boolean,
  fetches: FetchMetadata[],
  policy: PageFetchOptions = {},
  forceRefreshUrls: ReadonlySet<string> = new Set()
): Promise<LoadedPage<T>> {
  const effectivePolicy = forceRefreshUrls.has(new URL(url).href) ? { ...policy, forceRefresh: true } : policy;
  let fetched: FetchResult;
  try {
    fetched = snapshotOnly ? await fetcher.readSnapshot(url) : await fetcher.fetchPage(url, effectivePolicy);
    fetches.push(fetched.metadata);
  } catch (error) {
    const metadata = error instanceof FetchError ? error.metadata : null;
    if (metadata) fetches.push(metadata);
    return {
      fetch: null,
      report: null,
      issue: issue(
        "error",
        "FETCH_FAILED",
        error instanceof Error ? error.message : String(error),
        url,
        null,
        null,
        metadata?.httpStatus ?? null
      )
    };
  }

  try {
    const parsed = parser(fetched.html, url);
    const checkpointIssue = await checkpoint(fetcher, fetched, (parsed.records.length || parsed.issues.some((entry) => entry.code === "TEAM_ANALYSIS_METRICS_UNAVAILABLE")) ? parsed.status : "partial", effectivePolicy);
    return { fetch: fetched, report: parsed, issue: checkpointIssue };
  } catch (error) {
    await checkpoint(fetcher, fetched, "failed", effectivePolicy);
    const selector = error instanceof ParserError ? error.selector : null;
    return {
      fetch: fetched,
      report: null,
      issue: issue(
        "error",
        "PARSE_FAILED",
        error instanceof Error ? error.message : String(error),
        url,
        selector,
        null,
        null
      )
    };
  }
}

function matchTabUrl(fixtureUrl: string, gameId: string, tab: "summary" | "boxscore"): string {
  const url = new URL(fixtureUrl);
  const baseMatchPath = url.pathname.match(/^(.*\/match\/\d+)(?:\/(?:preview|summary|boxscore))?\/?$/);
  if (!baseMatchPath?.[1]) {
    throw new Error(`URL pertandingan ${gameId} tidak memiliki pola tab yang didukung: ${fixtureUrl}`);
  }
  url.pathname = `${baseMatchPath[1]}/${tab}`;
  url.search = "";
  url.hash = "";
  return url.href;
}

function markFetchPartial(fetches: FetchMetadata[], url: string, message: string): void {
  const existing = [...fetches].reverse().find((entry) => entry.requestUrl === url);
  if (existing) {
    existing.parseStatus = "partial";
    existing.error = existing.error ? `${existing.error}; ${message}` : message;
  }
}

export async function discoverCompetition(input: string, options: PipelineOptions = {}): Promise<PipelineResult> {
  return runCompetition(input, { ...options, includeMatches: false });
}

export async function syncCompetition(input: string, options: PipelineOptions = {}): Promise<PipelineResult> {
  return runCompetition(input, { ...options, includeMatches: true });
}

async function runCompetition(input: string, options: PipelineOptions): Promise<PipelineResult> {
  const url = competitionUrl(input);
  const fetcher = options.fetcher ?? new HtmlFetcher();
  const snapshotOnly = options.snapshotOnly ?? false;
  const fetches: FetchMetadata[] = [];
  const globalIssues: ValidationIssue[] = [];

  const forceRefresh = options.forceRefresh ?? false;
  const forceRefreshUrls = options.forceRefreshUrls ?? new Set<string>();
  const existingGameIds = options.existingGameIds;
  const fixtureRefresh = forceRefresh || options.incrementalGames !== undefined;
  const root = await loadPage(url.href, parseFixturesHtml, fetcher, snapshotOnly, fetches, pagePolicy("competition", fixtureRefresh), forceRefreshUrls);
  if (!root.report?.records[0]) {
    if (root.issue) globalIssues.push(root.issue);
    throw new PipelineError("Halaman kompetisi/Fixtures gagal diparse.", url.href, fetches, globalIssues);
  }
  const pageData = root.report.records[0];
  if (root.issue) globalIssues.push(root.issue);
  globalIssues.push(...root.report.issues);
  const competition: CompetitionRecord = pageData.competition;
  const allFixtures = new Map(pageData.games.map((game) => [game.sourceId, game]));
  const fixturePageUrls = new Set<string>([url.href]);
  let fixturePageQueue: string[] = (options.fixturePageResumeUrls ?? []).map((candidate) => {
    const validated = fixturePageUrl(candidate, competition.sourceUrl);
    if (!validated) throw new PipelineError("URL kelanjutan fixture tidak valid atau berbeda kompetisi.", url.href, fetches, globalIssues);
    return validated;
  });
  try {
    fixturePageQueue = [...new Set([...fixturePageQueue, ...parseFixturePageLinksHtml(root.fetch?.html ?? "", url.href)])];
  } catch (error) {
    globalIssues.push(issue("warning", "FIXTURE_PAGE_LINKS_UNAVAILABLE", error instanceof Error ? error.message : String(error), url.href, "fixtures.links"));
  }
  const configuredPageLimit = Number(process.env["STATSARENA_FIXTURE_PAGE_LIMIT"] ?? "100");
  if (configuredPageLimit === 1) throw new PipelineError("STATSARENA_FIXTURE_PAGE_LIMIT minimal 2 agar antrean fixture dapat dilanjutkan.", url.href, fetches, globalIssues);
  const fixturePageLimit = Number.isSafeInteger(configuredPageLimit) && configuredPageLimit > 0 ? Math.min(configuredPageLimit, 1_000) : 100;
  let fixturePagesRead = 1;
  const retryFixturePageUrls: string[] = [];
  while (fixturePageQueue.length && fixturePagesRead < fixturePageLimit) {
    const nextUrl = fixturePageQueue.shift();
    if (!nextUrl || fixturePageUrls.has(nextUrl)) continue;
    fixturePageUrls.add(nextUrl);
    const page = await loadPage(nextUrl, parseFixturesHtml, fetcher, snapshotOnly, fetches, pagePolicy("competition", fixtureRefresh), forceRefreshUrls);
    fixturePagesRead += 1;
    if (page.issue) globalIssues.push(page.issue);
    if (page.report?.status !== "parsed") retryFixturePageUrls.push(nextUrl);
    if (!page.report?.records[0]) continue;
    const extra = page.report.records[0];
    if (extra.competition.sourceId !== competition.sourceId) {
      globalIssues.push(issue("error", "FIXTURE_PAGE_COMPETITION_MISMATCH", "Tautan fixture menunjuk ke kompetisi yang berbeda; halaman dilewati.", nextUrl, "competition.sourceId", competition.sourceId, extra.competition.sourceId));
      continue;
    }
    globalIssues.push(...page.report.issues);
    for (const game of extra.games) allFixtures.set(game.sourceId, game);
    if (page.fetch) {
      try {
        for (const discoveredUrl of parseFixturePageLinksHtml(page.fetch.html, nextUrl)) {
          if (!fixturePageUrls.has(discoveredUrl) && !fixturePageQueue.includes(discoveredUrl)) fixturePageQueue.push(discoveredUrl);
        }
      } catch (error) {
        globalIssues.push(issue("warning", "FIXTURE_PAGE_LINKS_UNAVAILABLE", error instanceof Error ? error.message : String(error), nextUrl, "fixtures.links"));
      }
    }
  }
  const remainingFixturePageUrls = [...new Set(fixturePageQueue.filter((candidate) => !fixturePageUrls.has(candidate)))];
  const pendingFixturePageUrls = [...new Set([...remainingFixturePageUrls, ...retryFixturePageUrls])];
  if (remainingFixturePageUrls.length) {
    globalIssues.push(issue("error", "FIXTURE_PAGE_LIMIT_REACHED", `Cakupan fixture belum lengkap: ${remainingFixturePageUrls.length} halaman menunggu kelanjutan. Runner menyimpan antrean untuk siklus berikutnya.`, url.href, "fixtures.pages", fixturePageLimit, fixturePagesRead));
  }
  const rootFixtures = [...allFixtures.values()];

  let selectedGames: GameRecord[] = [];
  const refreshGameIds = new Set<string>();
  const selectionCounts: Record<string, number> = {};
  const selectionReasons = new Map<string, IncrementalReason>();
  let unchangedMatchesSkipped = 0;
  if (options.includeMatches) {
    const candidates = options.incrementalGames === undefined ? rootFixtures : rootFixtures.filter((game) => {
      const reason = incrementalReason(game, options.incrementalGames?.get(game.sourceId), forceRefreshUrls);
      if (reason === null) { unchangedMatchesSkipped += 1; return false; }
      selectionReasons.set(game.sourceId, reason);
      return true;
    });
    if (options.incrementalGames) {
      const rank = { active: 0, new: 1, changed: 2, retry: 3, parser_changed: 4, unverified: 5 };
      candidates.sort((a, b) => rank[selectionReasons.get(a.sourceId) ?? "unverified"] - rank[selectionReasons.get(b.sourceId) ?? "unverified"]);
    }
    const limit = options.matchLimit;
    selectedGames = limit === undefined ? candidates : candidates.slice(0, Math.max(0, limit));
    for (const game of selectedGames) {
      const reason = selectionReasons.get(game.sourceId);
      if (!reason) continue;
      selectionCounts[`selected_${reason}`] = (selectionCounts[`selected_${reason}`] ?? 0) + 1;
      const targetedRetry = reason === "retry" && [...forceRefreshUrls].some((url) =>
        sourceEntityId(url, "match") === game.sourceId && sourceEntityId(url, "competition") === competition.sourceId);
      if (reason !== "unverified" && reason !== "parser_changed" && !targetedRetry) refreshGameIds.add(game.sourceId);
    }
    if (limit !== undefined && selectedGames.length < candidates.length) {
      globalIssues.push(issue(
        "warning",
        "MATCH_LIMIT_APPLIED",
        `Hanya ${selectedGames.length} dari ${candidates.length} fixture terpilih yang disinkronkan karena batas sampel.`,
        url.href,
        "matches",
        candidates.length,
        selectedGames.length
      ));
    }
  }

  const teamUrl = sourceUrlFor(url, "teams");
  const playersUrl = sourceUrlFor(url, "players");
  const standingsUrl = sourceUrlFor(url, "standings");
  let teamStatisticsUrl: string | null = null;
  if (root.fetch) {
    try {
      teamStatisticsUrl = parseCompetitionStatisticsLinkHtml(root.fetch.html, url.href).records[0]?.sourceUrl ?? null;
    } catch (error) {
      globalIssues.push(issue("warning", "TEAM_STATISTICS_LINK_UNAVAILABLE", error instanceof Error ? error.message : String(error), url.href, "statistics/team"));
    }
  }
  const teamStatisticsPromise = teamStatisticsUrl
    ? loadPage(teamStatisticsUrl, parseTeamStatisticsHtml, fetcher, snapshotOnly, fetches, pagePolicy("registry", forceRefresh), forceRefreshUrls)
    : Promise.resolve(null);
  const [matchImportData, teamPage, playerPage, standingsIndexPage, teamStatisticsPage] = await Promise.all([
    loadMatches(selectedGames, fetcher, snapshotOnly, fetches, forceRefresh, forceRefreshUrls, existingGameIds, refreshGameIds),
    loadPage(teamUrl, parseTeamsHtml, fetcher, snapshotOnly, fetches, pagePolicy("registry", forceRefresh), forceRefreshUrls),
    loadPage(playersUrl, parsePlayersHtml, fetcher, snapshotOnly, fetches, pagePolicy("registry", forceRefresh), forceRefreshUrls),
    loadPage(standingsUrl, parseStandingsGroupLinksHtml, fetcher, snapshotOnly, fetches, pagePolicy("standings", forceRefresh), forceRefreshUrls),
    teamStatisticsPromise
  ]);
  if (teamPage.issue) globalIssues.push(teamPage.issue);
  if (playerPage.issue) globalIssues.push(playerPage.issue);
  if (standingsIndexPage.issue) globalIssues.push(standingsIndexPage.issue);
  if (teamStatisticsPage?.issue) globalIssues.push(teamStatisticsPage.issue);
  if (teamPage.report) globalIssues.push(...teamPage.report.issues);
  if (playerPage.report) globalIssues.push(...playerPage.report.issues);
  if (standingsIndexPage.report) globalIssues.push(...standingsIndexPage.report.issues);
  if (teamStatisticsPage?.report) globalIssues.push(...teamStatisticsPage.report.issues);

  const groups = standingsIndexPage.report?.records ?? [];
  const groupPages = await Promise.all(groups.map(async (group) => {
    const loaded = await loadPage(group.sourceUrl, parseStandingsHtml, fetcher, snapshotOnly, fetches, pagePolicy("standings", forceRefresh), forceRefreshUrls);
    if (loaded.issue?.severity === "error") return { group, loaded, data: null };
    if (loaded.issue) globalIssues.push(loaded.issue);
    if (!loaded.report) return { group, loaded, data: null };
    globalIssues.push(...loaded.report.issues);
    if (loaded.report.status !== "parsed" || !loaded.report.records[0]) {
      markFetchPartial(fetches, group.sourceUrl, "Klasemen grup tidak lengkap; snapshot database sebelumnya dipertahankan.");
      return { group, loaded, data: null };
    }
    return { group, loaded, data: loaded.report.records[0] };
  }));

  const groupStandings: GroupStandingsData[] = [];
  for (const page of groupPages) {
    if (page.data) groupStandings.push(page.data);
    else if (page.loaded.issue) globalIssues.push(page.loaded.issue);
  }
  const data: ParsedCompetitionData = {
    competition,
    teams: teamPage.report?.records ?? [],
    players: playerPage.report?.records ?? [],
    groups: groupStandings,
    teamOfficialMetrics: teamStatisticsPage?.report ?? null,
    matches: matchImportData,
    // The root and schedule can repeat the same fixture. Preserve distinct
    // observations while avoiding duplicate review issues for identical data.
    issues: [...new Map(globalIssues.map((entry) => [JSON.stringify(entry), entry])).values()]
  };
  const parseCounts = {
    competitions: 1,
    teams: data.teams.length,
    players: data.players.length,
    groups: groups.length,
    standingRows: data.groups.reduce((sum, group) => sum + group.rows.length, 0),
    fixturesDiscovered: rootFixtures.length,
    fixturePagesRead,
    pendingFixturePages: pendingFixturePageUrls.length,
    matchesProcessed: data.matches.length,
    unchangedMatchesSkipped,
    ...selectionCounts,
    summaries: data.matches.filter((match) => match.summary !== null).length,
    boxScores: data.matches.filter((match) => match.boxScore !== null).length,
    playerBoxScoreRows: data.matches.reduce((sum, match) => sum + (match.boxScore?.players.length ?? 0), 0),
    teamBoxScoreRows: data.matches.reduce((sum, match) => sum + (match.boxScore?.teams.length ?? 0), 0),
    playByPlayEvents: data.matches.reduce((sum, match) => sum + (match.playByPlay?.records.length ?? 0), 0),
    shots: data.matches.reduce((sum, match) => sum + (match.shotChart?.records.length ?? 0), 0),
    gameOfficialMetrics: data.matches.reduce((sum, match) => sum + (match.officialMetrics?.records.length ?? 0), 0),
    competitionOfficialMetrics: data.teamOfficialMetrics?.records.length ?? 0,
    scheduledMatches: data.matches.filter((match) => matchDataStatus(match) === "scheduled").length,
    fetchFailedMatches: data.matches.filter((match) => matchDataStatus(match) === "fetch_failed").length,
    partialBoxScoreMatches: data.matches.filter((match) => matchDataStatus(match) === "boxscore_partial").length,
    parseFailedMatches: data.matches.filter((match) => matchDataStatus(match) === "parse_failed").length,
    ...fetchCounts(fetches),
    issues: data.issues.length + data.matches.reduce((sum, match) => sum + match.issues.length, 0)
  };
  return { data, fetches, parseCounts, pendingFixturePageUrls, fixtureObservations: rootFixtures };
}

/** Count every retrieval, including attempts before a detail refresh. */
export function fetchCounts(fetches: readonly FetchMetadata[]): Record<string, number> {
  return {
    fetches: fetches.length,
    networkRequests: fetches.reduce((sum, entry) => sum + entry.attempts.filter((attempt) => attempt.attempt > 0).length, 0),
    cacheHits: fetches.filter((entry) => entry.retrievalMode === "cache").length,
    revalidatedPages: fetches.filter((entry) => entry.retrievalMode === "revalidated").length,
    snapshotReads: fetches.filter((entry) => entry.retrievalMode === "snapshot").length,
    failedFetchPages: fetches.filter((entry) => entry.fetchStatus === "failed").length,
    failedParsePages: fetches.filter((entry) => entry.fetchStatus === "succeeded" && entry.parseStatus === "failed").length,
    partialPages: fetches.filter((entry) => entry.fetchStatus === "succeeded" && entry.parseStatus === "partial").length,
    timeoutAttempts: fetches.reduce((sum, entry) => sum + entry.attempts.filter((attempt) => attempt.errorKind === "timeout").length, 0)
  };
}

async function loadMatch(
  fixture: GameRecord,
  fetcher: HtmlFetcher,
  snapshotOnly: boolean,
  fetches: FetchMetadata[],
  forceRefresh: boolean,
  forceRefreshUrls: ReadonlySet<string>
): Promise<MatchImportData> {
  if (fixture.status === "scheduled") {
    return { fixture, summary: null, boxScore: null, issues: [],
      availability: { summary: "scheduled", boxScore: "scheduled", playByPlay: "scheduled", shotChart: "scheduled", analysis: "scheduled" },
      playByPlay: null, shotChart: null, officialMetrics: null };
  }
  const issues: ValidationIssue[] = [];
  let summary: SummaryRecord | null = null;
  let boxScore: BoxScoreRecord | null = null;
  let summaryUrl: string;
  let boxScoreUrl: string;
  try {
    summaryUrl = matchTabUrl(fixture.sourceUrl, fixture.sourceId, "summary");
    boxScoreUrl = matchTabUrl(fixture.sourceUrl, fixture.sourceId, "boxscore");
  } catch (error) {
    issues.push(issue("error", "MATCH_URL_INVALID", error instanceof Error ? error.message : String(error), fixture.sourceUrl, "sourceUrl"));
    return { fixture, summary, boxScore, issues };
  }

  const policy = matchPolicy(fixture, forceRefresh);
  const summaryPage = await loadPage(summaryUrl, parseSummaryHtml, fetcher, snapshotOnly, fetches, policy, forceRefreshUrls);
  let tabLinks = null;
  if (summaryPage.fetch) {
    try {
      const linkReport = parseMatchDetailTabLinksHtml(summaryPage.fetch.html, summaryUrl);
      tabLinks = linkReport.records[0] ?? null;
      issues.push(...linkReport.issues);
    } catch (error) {
      issues.push(issue("warning", "MATCH_DETAIL_LINKS_UNAVAILABLE", error instanceof Error ? error.message : String(error), summaryUrl, "tabs"));
    }
  }
  boxScoreUrl = tabLinks?.boxScore ?? boxScoreUrl;
  const [boxScorePage, playByPlayPage, shotChartPage, analysisPage] = await Promise.all([
    loadPage(boxScoreUrl, parseBoxScoreHtml, fetcher, snapshotOnly, fetches, policy, forceRefreshUrls),
    tabLinks?.playByPlay ? loadPage(tabLinks.playByPlay, parsePlayByPlayHtml, fetcher, snapshotOnly, fetches, policy, forceRefreshUrls) : Promise.resolve(null),
    tabLinks?.shotChart ? loadPage(tabLinks.shotChart, parseShotChartHtml, fetcher, snapshotOnly, fetches, policy, forceRefreshUrls) : Promise.resolve(null),
    tabLinks?.analysis ? loadPage(tabLinks.analysis, parseTeamAnalysisHtml, fetcher, snapshotOnly, fetches, policy, forceRefreshUrls) : Promise.resolve(null)
  ]);
  if (summaryPage.issue) issues.push(summaryPage.issue);
  if (boxScorePage.issue) issues.push(boxScorePage.issue);
  for (const page of [playByPlayPage, shotChartPage, analysisPage]) if (page?.issue) issues.push(page.issue);
  if (summaryPage.report) {
    issues.push(...summaryPage.report.issues);
    summary = summaryPage.report.records[0] ?? null;
  }
  if (boxScorePage.report) {
    issues.push(...boxScorePage.report.issues);
    if (boxScorePage.report.status === "parsed") boxScore = boxScorePage.report.records[0] ?? null;
    else markFetchPartial(fetches, boxScoreUrl, "Box score tidak lengkap; statistik tersimpan sebelumnya dipertahankan.");
  }
  if (playByPlayPage?.report) issues.push(...playByPlayPage.report.issues);
  if (shotChartPage?.report) issues.push(...shotChartPage.report.issues);
  if (analysisPage?.report) issues.push(...analysisPage.report.issues);
  if (boxScore) {
    const validation = validateBoxScore(boxScore, summary);
    issues.push(...validation);
    if (validation.some((entry) => entry.severity === "error")) {
      for (const page of [boxScorePage, summaryPage]) {
        if (page.fetch) {
          const failedCheckpoint = await checkpoint(fetcher, page.fetch, "partial", policy);
          if (failedCheckpoint) issues.push(failedCheckpoint);
        }
      }
    }
  }
  if (boxScore && shotChartPage?.report) {
    const shotIssues = validateShotsAgainstBoxScore(shotChartPage.report, boxScore);
    issues.push(...shotIssues);
    if (shotIssues.some((entry) => entry.severity === "error")) {
      shotChartPage.report.status = "partial";
      shotChartPage.report.issues.push(...shotIssues);
      if (shotChartPage.fetch) {
        const checkpointIssue = await checkpoint(fetcher, shotChartPage.fetch, "partial", policy);
        if (checkpointIssue) issues.push(checkpointIssue);
      }
    }
  }
  return { fixture, summary, boxScore, issues, availability: {
    summary: pageAvailability(summaryPage), boxScore: pageAvailability(boxScorePage),
    playByPlay: playByPlayPage ? pageAvailability(playByPlayPage) : "unavailable",
    shotChart: shotChartPage ? pageAvailability(shotChartPage) : "unavailable",
    analysis: analysisPage ? pageAvailability(analysisPage) : "unavailable"
  },
  playByPlay: playByPlayPage?.report ?? null,
  shotChart: shotChartPage?.report ?? null,
  officialMetrics: analysisPage?.report ?? null
  };
}

function pageAvailability<T>(page: LoadedPage<T>): PageAvailability {
  if (page.issue?.code === "FETCH_FAILED") return "fetch_failed";
  if (page.issue?.code === "PARSE_FAILED") return "parse_failed";
  if (page.report?.status === "partial") return "partial";
  return page.report?.records.length ? "available" : "unavailable";
}
async function loadMatches(
  fixtures: GameRecord[], fetcher: HtmlFetcher, snapshotOnly: boolean, fetches: FetchMetadata[],
  forceRefresh: boolean, forceRefreshUrls: ReadonlySet<string>, existingGameIds?: ReadonlySet<string>, refreshGameIds: ReadonlySet<string> = new Set()
): Promise<MatchImportData[]> {
  const ranked = fixtures.map((fixture, index) => ({ fixture, index })).sort((a, b) => {
    const rank = (game: GameRecord) => {
      if (game.status === "live") return 0;
      if (game.status === "unknown") return 1;
      if (game.status !== "scheduled" && existingGameIds && !existingGameIds.has(game.sourceId)) return 2;
      return game.status === "complete" ? 3 : 4;
    };
    return rank(a.fixture) - rank(b.fixture) || a.index - b.index;
  });
  const result = await Promise.all(ranked.map(async ({ fixture, index }) => ({
    index, match: await loadMatch(fixture, fetcher, snapshotOnly, fetches, forceRefresh || refreshGameIds.has(fixture.sourceId), forceRefreshUrls).then((match) => ({
      ...match, datasetQuality: buildDetailQuality(match.availability ?? {}, match.issues)
    }))
  })));
  return result.sort((a, b) => a.index - b.index).map((entry) => entry.match);
}

async function checkpoint(fetcher: HtmlFetcher, fetched: FetchResult, status: "parsed" | "partial" | "failed", policy: PageFetchOptions): Promise<ValidationIssue | null> {
  try {
    await fetcher.recordParseResult(fetched, status, policy);
    return null;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    fetched.metadata.error = `Checkpoint tidak tersimpan: ${message}`;
    return issue("warning", "CACHE_CHECKPOINT_FAILED", message, fetched.metadata.requestUrl);
  }
}
