import { readServiceState, serviceIsHealthy } from "./operations/service.js";
import { fileURLToPath } from "node:url";
import { resolve, relative, sep, isAbsolute } from "node:path";

const root = fileURLToPath(new URL("../../", import.meta.url));
const directory = resolve(root, process.env["STATSARENA_SNAPSHOT_DIR"] ?? "ingest/snapshots");
const rel = relative(resolve(root, "ingest/snapshots"), directory);
try {
  if (rel === ".." || rel.startsWith(`..${sep}`) || isAbsolute(rel)) throw new Error("Path tidak valid.");
  process.exitCode = serviceIsHealthy(await readServiceState(directory)) ? 0 : 1;
} catch { process.exitCode = 1; }
