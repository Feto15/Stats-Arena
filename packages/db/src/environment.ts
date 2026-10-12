import { loadEnvFile } from "node:process";
import { fileURLToPath } from "node:url";

/** Resolve against this module so pnpm --dir does not change the environment file. */
export function loadProjectEnv(path = fileURLToPath(new URL("../../../.env", import.meta.url))): void {
  try {
    // Node preserves values already supplied by the shell or hosting environment.
    loadEnvFile(path);
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") return;
    throw error;
  }
}
