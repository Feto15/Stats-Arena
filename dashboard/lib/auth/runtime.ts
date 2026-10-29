import "server-only";
import { getDashboardDatabase } from "../data/connection";
import { authSettings } from "./settings";
import { createReportAuth } from "./factory";

let auth: ReturnType<typeof createReportAuth> | undefined;
export function getAuthDatabase() {
  authSettings();
  return getDashboardDatabase();
}
export function getAuth() { return auth ??= createReportAuth(getAuthDatabase(), authSettings()); }
