import { readFile } from "node:fs/promises";
import { z } from "zod";
import { competitionUrl, competitionReference } from "../domain/source-url.js";

const competitionEntrySchema = z.object({
  sourceUrl: z.string().min(1),
  active: z.boolean().default(true),
  label: z.string().trim().min(1).optional()
}).strict();

const competitionConfigSchema = z.object({
  version: z.literal(1),
  competitions: z.array(competitionEntrySchema)
}).strict();

export interface ActiveCompetition {
  sourceUrl: string;
  sourceCompetitionId: string;
  label?: string;
}

export function parseCompetitionConfig(input: unknown): ActiveCompetition[] {
  const parsed = competitionConfigSchema.parse(input);
  const seen = new Set<string>();
  return parsed.competitions.filter((entry) => entry.active).map((entry) => {
    const url = competitionUrl(entry.sourceUrl);
    const sourceCompetitionId = competitionReference(url.href).key;
    if (!sourceCompetitionId) throw new Error(`ID kompetisi tidak ditemukan pada URL konfigurasi: ${url.href}`);
    if (seen.has(sourceCompetitionId)) throw new Error(`ID kompetisi ${sourceCompetitionId} muncul lebih dari sekali di konfigurasi.`);
    seen.add(sourceCompetitionId);
    return { sourceUrl: url.href, sourceCompetitionId, ...(entry.label ? { label: entry.label } : {}) };
  });
}

export async function readCompetitionConfig(path: string): Promise<ActiveCompetition[]> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(await readFile(path, "utf8")) as unknown;
  } catch (error) {
    throw new Error(`Gagal membaca konfigurasi kompetisi ${path}: ${error instanceof Error ? error.message : String(error)}`, { cause: error });
  }
  return parseCompetitionConfig(parsed);
}

export function parseSyncIntervalSeconds(value: string | undefined, fallback = 900): number {
  if (value === undefined || value.trim() === "") return fallback;
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 30 || parsed > 86_400) {
    throw new Error("Interval sinkronisasi harus bilangan bulat 30–86400 detik.");
  }
  return parsed;
}
