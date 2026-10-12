import { readFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const fixtureDirectory = resolve(dirname(fileURLToPath(import.meta.url)), "fixtures/live-2026-10-06");
const stage5FixtureDirectory = resolve(dirname(fileURLToPath(import.meta.url)), "fixtures/live-2026-10-08");

export function loadHtmlFixture(file: string): string {
  return gunzipSync(readFileSync(resolve(fixtureDirectory, file))).toString("utf8");
}

export function loadStage5HtmlFixture(file: string): string {
  return gunzipSync(readFileSync(resolve(stage5FixtureDirectory, file))).toString("utf8");
}
