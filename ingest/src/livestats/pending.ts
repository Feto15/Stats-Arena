import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, rename, stat, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { z } from "zod";

const checkpointSchema = z.object({ version: z.literal(1), competition: z.string(), games: z.array(z.string().regex(/^[1-9]\d{0,31}$/)).max(10000) });
function path(directory: string, competition: string) { return resolve(directory, `${createHash("sha256").update(competition).digest("hex")}.pending.json`); }

/** A failed transaction stays eligible even after a forced refresh of ready data. */
export async function readPendingLiveStats(directory: string, competition: string): Promise<Set<string>> {
  try {
    const file = path(directory, competition);
    if ((await stat(file)).size > 1024 * 1024) throw new Error("Checkpoint LiveStats terlalu besar.");
    const parsed = checkpointSchema.parse(JSON.parse(await readFile(file, "utf8")) as unknown);
    if (parsed.competition !== competition) throw new Error("Scope checkpoint LiveStats berbeda.");
    return new Set(parsed.games);
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") return new Set();
    throw error;
  }
}

export async function writePendingLiveStats(directory: string, competition: string, games: Set<string>): Promise<void> {
  const value = checkpointSchema.parse({ version: 1, competition, games: [...games] });
  await mkdir(directory, { recursive: true });
  const file = path(directory, competition), temp = `${file}.${randomUUID()}.tmp`;
  await writeFile(temp, `${JSON.stringify(value)}\n`, { flag: "wx" });
  await rename(temp, file);
}
