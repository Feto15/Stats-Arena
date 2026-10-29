import { loadEnvFile } from "node:process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

/** Resolve against this module so pnpm --dir does not change the environment file. */
export function loadProjectEnv(path = resolve(dirname(fileURLToPath(import.meta.url)), "../../../.env")): void {
  try {
    // Keep this a runtime filesystem path; new URL(".../.env", import.meta.url) is bundled as an asset by Webpack.
    // Node preserves values already supplied by the shell or hosting environment.
    loadEnvFile(path);
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") return;
    throw error;
  }
}
