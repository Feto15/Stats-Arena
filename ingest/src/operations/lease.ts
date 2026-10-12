import { and, eq, gt, lt, ne, sql } from "drizzle-orm";
import { hostname } from "node:os";
import { randomUUID } from "node:crypto";
import type { StatsArenaDatabase } from "@statsarena/db";
import { SOURCE_NAME } from "../domain/types.js";
import { syncLeases, syncRuns } from "@statsarena/db/schema";

type SyncTransaction = Parameters<Parameters<StatsArenaDatabase["transaction"]>[0]>[0];

export const SYNC_LEASE_TTL_MS = 120_000;

export class SyncLeaseBusyError extends Error {
  constructor(readonly sourceCompetitionId: string) {
    super(`Kompetisi ${sourceCompetitionId} sedang disinkronkan oleh proses lain.`);
    this.name = "SyncLeaseBusyError";
  }
}

export class SyncLeaseLostError extends Error {
  constructor(readonly sourceCompetitionId: string) {
    super(`Lease sinkronisasi kompetisi ${sourceCompetitionId} tidak lagi dimiliki proses ini.`);
    this.name = "SyncLeaseLostError";
  }
}

export interface SyncLease {
  ownerId: string;
  sourceCompetitionId: string;
  heartbeat(): Promise<void>;
  assertOwned(): Promise<void>;
  guardTransaction(transaction: SyncTransaction): Promise<void>;
  release(): Promise<void>;
}

export async function acquireSyncLease(
  db: StatsArenaDatabase,
  sourceCompetitionId: string,
  ownerId = randomUUID(),
  ttlMs = SYNC_LEASE_TTL_MS
): Promise<SyncLease> {
  const expiry = () => sql`now() + ${ttlMs} * interval '1 millisecond'`;
  const [lease] = await db.insert(syncLeases).values({
    source: SOURCE_NAME,
    sourceCompetitionId,
    ownerId,
    hostname: hostname(),
    processId: process.pid,
    acquiredAt: sql`now()`,
    heartbeatAt: sql`now()`,
    expiresAt: expiry()
  }).onConflictDoUpdate({
    target: [syncLeases.source, syncLeases.sourceCompetitionId],
    set: {
      ownerId,
      hostname: hostname(),
      processId: process.pid,
      acquiredAt: sql`now()`,
      heartbeatAt: sql`now()`,
      expiresAt: expiry()
    },
    setWhere: sql`${syncLeases.expiresAt} <= now()`
  }).returning({ ownerId: syncLeases.ownerId });
  if (lease?.ownerId !== ownerId) throw new SyncLeaseBusyError(sourceCompetitionId);

  const staleBefore = new Date(Date.now() - ttlMs);
  await db.update(syncRuns).set({
    status: "failed",
    finishedAt: new Date(),
    resultSummary: "Run sebelumnya berhenti mengirim heartbeat; lease kedaluwarsa dan data aman dilanjutkan."
  }).where(and(
    eq(syncRuns.source, SOURCE_NAME),
    eq(syncRuns.sourceCompetitionId, sourceCompetitionId),
    eq(syncRuns.status, "running"),
    lt(syncRuns.heartbeatAt, staleBefore),
    ne(syncRuns.ownerId, ownerId)
  ));

  return {
    ownerId,
    sourceCompetitionId,
    async heartbeat() {
      const [updated] = await db.update(syncLeases).set({
        heartbeatAt: sql`now()`,
        expiresAt: expiry()
      }).where(and(
        eq(syncLeases.source, SOURCE_NAME),
        eq(syncLeases.sourceCompetitionId, sourceCompetitionId),
        eq(syncLeases.ownerId, ownerId),
        gt(syncLeases.expiresAt, sql`now()`)
      )).returning({ ownerId: syncLeases.ownerId });
      if (updated?.ownerId !== ownerId) throw new SyncLeaseLostError(sourceCompetitionId);
    },
    async assertOwned() {
      const [current] = await db.select({ ownerId: syncLeases.ownerId }).from(syncLeases).where(and(
        eq(syncLeases.source, SOURCE_NAME),
        eq(syncLeases.sourceCompetitionId, sourceCompetitionId),
        eq(syncLeases.ownerId, ownerId),
        gt(syncLeases.expiresAt, sql`now()`)
      )).limit(1);
      if (current?.ownerId !== ownerId) throw new SyncLeaseLostError(sourceCompetitionId);
    },
    async guardTransaction(transaction) {
      const [current] = await transaction.select({ ownerId: syncLeases.ownerId }).from(syncLeases).where(and(
        eq(syncLeases.source, SOURCE_NAME),
        eq(syncLeases.sourceCompetitionId, sourceCompetitionId),
        eq(syncLeases.ownerId, ownerId),
        gt(syncLeases.expiresAt, sql`now()`)
      )).for("update").limit(1);
      if (current?.ownerId !== ownerId) throw new SyncLeaseLostError(sourceCompetitionId);
    },
    async release() {
      await db.delete(syncLeases).where(and(
        eq(syncLeases.source, SOURCE_NAME),
        eq(syncLeases.sourceCompetitionId, sourceCompetitionId),
        eq(syncLeases.ownerId, ownerId)
      ));
    }
  };
}
