import "server-only";
import { resolve } from "node:path";
import { createDatabase } from "@statsarena/db";
import { loadProjectEnv } from "@statsarena/db/env";
let connection: ReturnType<typeof createDatabase> | undefined;
export function getDashboardDatabase() {
  if (!connection) { loadProjectEnv(resolve(process.cwd(), "../.env")); connection = createDatabase(); }
  return connection.db;
}
