import type { ValidationIssue } from "../domain/types.js";
import type { FetchMetadata } from "../fetch/fetcher.js";

export function safeError(error: unknown): string {
  const raw = error instanceof Error ? error.message : String(error);
  return raw.replace(/postgres(?:ql)?:\/\/[^\s"']+/gi, "[DATABASE_URL redacted]");
}

/** Preserve retrieval context even when the failure happens after parsing. */
export class SyncOperationError extends Error {
  constructor(
    cause: unknown,
    readonly sourceUrl: string,
    readonly fetches: FetchMetadata[],
    readonly issues: ValidationIssue[],
    readonly auditPath: string | null,
    readonly auditWriteError: string | null
  ) {
    super(safeError(cause), { cause });
    this.name = "SyncOperationError";
  }
}
