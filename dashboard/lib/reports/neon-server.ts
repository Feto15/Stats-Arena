import "server-only";
import { cache } from "react";
import { getDashboardDatabase } from "../data/connection";
import { getNeonClubReport, getNeonReportCatalog } from "./neon-queries";
import routes from "./data/report-routes.json";
export const readReportCatalog = cache(async () => getNeonReportCatalog(getDashboardDatabase(), routes.competitionKey));
export const readClubReport = cache(async (clubSourceId: string) => getNeonClubReport(getDashboardDatabase(), routes.competitionKey, clubSourceId));
