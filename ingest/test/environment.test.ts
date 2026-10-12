import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { pathToFileURL } from "node:url";

test("project environment resolves the root file from both package directories and preserves shell values", async () => {
  const root = await mkdtemp(join(tmpdir(), "statsarena-env-"));
  try {
    const moduleDir = join(root, "packages/db/src");
    await mkdir(moduleDir, { recursive: true });
    await mkdir(join(root, "ingest"));
    const modulePath = join(moduleDir, "environment.ts");
    await writeFile(modulePath, await readFile(new URL("../../packages/db/src/environment.ts", import.meta.url)));
    await writeFile(join(root, ".env"), "STATSARENA_TEST_ROOT=root\nSTATSARENA_TEST_EXISTING=file\n");
    await writeFile(join(root, "ingest/.env"), "STATSARENA_TEST_ROOT=wrong\n");
    const script = `import { loadProjectEnv } from ${JSON.stringify(pathToFileURL(modulePath).href)};
      loadProjectEnv();
      console.log(JSON.stringify([process.env.STATSARENA_TEST_ROOT, process.env.STATSARENA_TEST_EXISTING]));`;
    for (const cwd of [join(root, "ingest"), join(root, "packages/db")]) {
      const result = execFileSync(process.execPath, ["--import", import.meta.resolve("tsx"), "--input-type=module", "-e", script], {
        cwd, encoding: "utf8", env: { STATSARENA_TEST_EXISTING: "shell" }
      });
      assert.deepEqual(JSON.parse(result), ["root", "shell"]);
    }
    await rm(join(root, ".env"));
    const result = execFileSync(process.execPath, ["--import", import.meta.resolve("tsx"), "--input-type=module", "-e", script], {
      cwd: join(root, "ingest"), encoding: "utf8", env: { STATSARENA_TEST_EXISTING: "shell" }
    });
    assert.deepEqual(JSON.parse(result), [null, "shell"]);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
