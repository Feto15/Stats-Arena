import { hostname } from "node:os";
import { mkdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { randomUUID } from "node:crypto";

interface LockOwner {
  ownerId: string;
  hostname: string;
  processId: number;
  acquiredAt: string;
  heartbeatAt: string;
}

export class LockBusyError extends Error {
  constructor(readonly lockPath: string, readonly owner: LockOwner | null) {
    super(`Lock sedang dipakai${owner ? ` oleh ${owner.hostname}:${owner.processId}` : " oleh proses lain"}.`);
    this.name = "LockBusyError";
  }
}

function isAlive(processId: number): boolean {
  try {
    process.kill(processId, 0);
    return true;
  } catch (error) {
    return error instanceof Error && "code" in error && error.code !== "ESRCH";
  }
}

async function readOwner(path: string): Promise<LockOwner | null> {
  try {
    const value: unknown = JSON.parse(await readFile(join(path, "owner.json"), "utf8"));
    if (typeof value !== "object" || value === null) return null;
    const owner = value as Partial<LockOwner>;
    if (typeof owner.ownerId !== "string" || typeof owner.hostname !== "string" ||
        !Number.isSafeInteger(owner.processId) || typeof owner.heartbeatAt !== "string" ||
        typeof owner.acquiredAt !== "string") return null;
    return owner as LockOwner;
  } catch {
    return null;
  }
}

async function releaseIfStale(path: string, owner: LockOwner | null, staleAfterMs: number): Promise<boolean> {
  let heartbeat = owner ? Date.parse(owner.heartbeatAt) : Number.NaN;
  if (!owner) {
    try { heartbeat = (await stat(path)).mtimeMs; } catch { return false; }
    if (Date.now() - heartbeat < staleAfterMs) return false;
  } else {
    if (owner.hostname === hostname() && isAlive(owner.processId)) return false;
    if (Number.isFinite(heartbeat) && Date.now() - heartbeat < staleAfterMs) return false;
  }
  const displaced = `${path}.stale-${randomUUID()}`;
  try {
    await rename(path, displaced);
    const displacedOwner = await readOwner(displaced);
    if (owner && displacedOwner?.ownerId !== owner.ownerId) {
      try { await rename(displaced, path); } catch { /* a new owner already acquired this path */ }
      return false;
    }
    if (!owner && displacedOwner !== null) {
      try { await rename(displaced, path); } catch { /* a new owner already acquired this path */ }
      return false;
    }
    await rm(displaced, { recursive: true, force: true });
    return true;
  } catch {
    return false;
  }
}

export interface DirectoryLock {
  readonly path: string;
  readonly ownerId: string;
  heartbeat(): Promise<void>;
  assertOwned(): Promise<void>;
  release(): Promise<void>;
}

/** Atomic mkdir lock for same-host competition and snapshot-directory exclusion. */
export async function acquireDirectoryLock(
  path: string,
  ownerId: string,
  staleAfterMs = 120_000
): Promise<DirectoryLock> {
  const absolutePath = resolve(path);
  await mkdir(join(absolutePath, ".."), { recursive: true });
  const now = new Date().toISOString();
  const owner: LockOwner = { ownerId, hostname: hostname(), processId: process.pid, acquiredAt: now, heartbeatAt: now };
  try {
    await mkdir(absolutePath);
  } catch (error) {
    if (!(error instanceof Error) || !("code" in error) || error.code !== "EEXIST") throw error;
    const existing = await readOwner(absolutePath);
    if (await releaseIfStale(absolutePath, existing, staleAfterMs)) {
      await mkdir(absolutePath);
    } else {
      throw new LockBusyError(absolutePath, existing);
    }
  }
  await writeFile(join(absolutePath, "owner.json"), `${JSON.stringify(owner)}\n`, { flag: "wx" });

  async function assertOwned(): Promise<void> {
    const current = await readOwner(absolutePath);
    if (current?.ownerId !== ownerId) throw new LockBusyError(absolutePath, current);
  }

  return {
    path: absolutePath,
    ownerId,
    async heartbeat() {
      await assertOwned();
      const next: LockOwner = { ...owner, heartbeatAt: new Date().toISOString() };
      const temporary = join(absolutePath, `owner-${ownerId}.tmp`);
      await writeFile(temporary, `${JSON.stringify(next)}\n`);
      await rename(temporary, join(absolutePath, "owner.json"));
      owner.heartbeatAt = next.heartbeatAt;
    },
    assertOwned,
    async release() {
      const current = await readOwner(absolutePath);
      if (current?.ownerId !== ownerId) return;
      const releasing = `${absolutePath}.release-${ownerId}`;
      try {
        await rename(absolutePath, releasing);
        const movedOwner = await readOwner(releasing);
        if (movedOwner?.ownerId === ownerId) await rm(releasing, { recursive: true, force: true });
        else {
          try { await rename(releasing, absolutePath); } catch { /* never replace a newer owner's lock */ }
        }
      } catch (error) {
        if (!(error instanceof Error) || !("code" in error) || error.code !== "ENOENT") throw error;
      }
    }
  };
}

export function competitionLockPath(lockRoot: string, sourceCompetitionId: string): string {
  return join(resolve(lockRoot), `competition-${sourceCompetitionId}.lock`);
}

export function snapshotLockPath(snapshotDirectory: string): string {
  return join(resolve(snapshotDirectory), ".statsarena-sync.lock");
}
