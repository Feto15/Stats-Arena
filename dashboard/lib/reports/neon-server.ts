import "server-only";
import { cache } from "react";
import { getDashboardDatabase } from "../data/connection";
import { dashboardReadCache } from "../data/read-cache";
import { requireViewer, requireClub } from "../auth/server";
import { getNeonClubReport, getNeonReportCatalog, getNeonReportDirectory } from "./neon-queries";
import routes from "./data/report-routes.json";
export const readReportCatalog = cache(async () => dashboardReadCache.read({
  key: ["report-catalog-v1", routes.competitionKey], authorize: requireViewer,
  load: () => getNeonReportCatalog(getDashboardDatabase(), routes.competitionKey),
}));
export const readReportDirectory = cache(async () => dashboardReadCache.read({
  key: ["report-directory-v1", routes.competitionKey], authorize: requireViewer, ttlMs: 30_000,
  load: () => getNeonReportDirectory(getDashboardDatabase(), routes.competitionKey),
}));
export const readClubReport = cache(async (clubSourceId: string) => dashboardReadCache.read({
  key: ["club-report-v1", routes.competitionKey, clubSourceId], authorize: () => requireClub(routes.competitionKey, clubSourceId, "/reports"),
  load: () => getNeonClubReport(getDashboardDatabase(), routes.competitionKey, clubSourceId),
}));
