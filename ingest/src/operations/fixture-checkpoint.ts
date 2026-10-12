import { randomUUID } from "node:crypto";
import { mkdir, open, rename, rm, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { z } from "zod";
import { fixturePageUrl } from "../parsers/fixtures.js";

const MAX_CHECKPOINT_BYTES = 4 * 1024 * 1024;
const checkpointSchema = z.object({
  version: z.literal(1),
  sourceCompetitionId: z.string().regex(/^\d+$/),
  pendingUrls: z.array(z.string().max(8192)).max(10_000)
}).strict();

/** Read/write while the runner owns the snapshot directory lock. */
export class FixturePageCheckpoint {
  private readonly path: string;

  constructor(private readonly directory: string, private readonly sourceCompetitionId: string) {
    if (!/^\d+$/.test(sourceCompetitionId)) throw new Error("ID kompetisi checkpoint tidak valid.");
    this.path = resolve(directory, `.fixture-pages-${sourceCompetitionId}.json`);
  }

  async read(): Promise<string[]> {
    let file;
    try { file = await open(this.path, "r"); } catch (error) {
      if (error instanceof Error && "code" in error && error.code === "ENOENT") return [];
      throw error;
    }
    try {
      if ((await file.stat()).size > MAX_CHECKPOINT_BYTES) throw new Error("Checkpoint fixture melewati batas ukuran.");
      const parsed = checkpointSchema.parse(JSON.parse(await file.readFile("utf8")) as unknown);
      if (parsed.sourceCompetitionId !== this.sourceCompetitionId) throw new Error("Scope kompetisi checkpoint fixture tidak sesuai.");
      return this.validateUrls(parsed.pendingUrls);
    } finally { await file.close(); }
  }

  async write(pendingUrls: readonly string[]): Promise<void> {
    const checkpoint = checkpointSchema.parse({ version: 1, sourceCompetitionId: this.sourceCompetitionId, pendingUrls: this.validateUrls(pendingUrls) });
    const content = `${JSON.stringify(checkpoint)}\n`;
    if (Buffer.byteLength(content) > MAX_CHECKPOINT_BYTES) throw new Error("Checkpoint fixture melewati batas ukuran.");
    await mkdir(this.directory, { recursive: true });
    const temporary = `${this.path}.${randomUUID()}.tmp`;
    try {
      await writeFile(temporary, content, { flag: "wx" });
      await rename(temporary, this.path);
    } finally { await rm(temporary, { force: true }); }
  }

  private validateUrls(urls: readonly string[]): string[] {
    return [...new Set(urls.map((url) => {
      const validated = fixturePageUrl(url, this.sourceCompetitionId);
      if (!validated) throw new Error("URL checkpoint fixture tidak valid atau berbeda kompetisi.");
      return validated;
    }))];
  }
}
