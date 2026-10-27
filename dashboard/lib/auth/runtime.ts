import "server-only";
import { createDatabase } from "@statsarena/db";
import { authSettings } from "./settings";
import { createReportAuth } from "./factory";

let connection: ReturnType<typeof createDatabase> | undefined;
let auth: ReturnType<typeof createReportAuth> | undefined;
export function getAuthDatabase() {
  authSettings();
  return (connection ??= createDatabase()).db;
}
export function getAuth() { return auth ??= createReportAuth(getAuthDatabase(), authSettings()); }
