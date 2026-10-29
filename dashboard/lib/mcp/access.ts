import { and, eq, gt, isNull, or, sql } from "drizzle-orm";
import { z } from "zod";
import { authUsers, authSessions, authClubAccess, authRateLimits, authMcpClients, authMcpConsents, authMcpRefreshTokens, authMcpAccessTokens } from "@statsarena/db";
import type { AuthDatabase } from "../auth/factory";
import { canReadClub, grantSchema, type ReportViewer } from "../auth/policy";
import { MCP_SCOPE } from "./config";

export class McpAccessError extends Error {
  constructor(readonly status: 401 | 403 | 404 | 429, readonly code: string, message: string) { super(message); }
}
export const tokenIdentitySchema = z.object({ sub: z.string().min(1).max(256), sid: z.string().min(1).max(256), client_id: z.string().min(1).max(2048), scope: z.string().max(2000) });

/** The caller supplies verified JWT claims. No user/role/grant comes from tool arguments. */
export async function loadMcpViewer(db: AuthDatabase, claims: unknown, resource: string): Promise<ReportViewer> {
  const parsed = tokenIdentitySchema.safeParse(claims);
  if (!parsed.success || !parsed.data.scope.split(" ").includes(MCP_SCOPE)) throw new McpAccessError(401, "UNAUTHENTICATED", "Hubungkan kembali akun StatsArena.");
  const identity = parsed.data;
  const [account] = await db.select({ user: authUsers }).from(authUsers).innerJoin(authSessions, eq(authSessions.userId, authUsers.id))
    .where(and(eq(authUsers.id, identity.sub), eq(authSessions.id, identity.sid), gt(authSessions.expiresAt, new Date()))).limit(1);
  const [client] = await db.select({ id: authMcpClients.id }).from(authMcpClients).where(and(eq(authMcpClients.clientId, identity.client_id), or(isNull(authMcpClients.disabled), eq(authMcpClients.disabled, false)))).limit(1);
  const consents = await db.select().from(authMcpConsents).where(and(eq(authMcpConsents.userId, identity.sub), eq(authMcpConsents.clientId, identity.client_id)));
  if (!account || !client || !consents.some(c => c.scopes.includes(MCP_SCOPE) && c.resources?.includes(resource))) throw new McpAccessError(401, "CONNECTION_REVOKED", "Koneksi StatsArena berakhir atau telah dicabut. Hubungkan kembali akun.");
  const rows = await db.select().from(authClubAccess).where(eq(authClubAccess.userId, account.user.id));
  const grants = rows.flatMap(row => { const p = grantSchema.safeParse(row); return p.success ? [p.data] : []; });
  return { id: account.user.id, name: account.user.name, email: account.user.email, isAdmin: account.user.isAdmin, grants };
}
export function requireMcpClub(viewer: ReportViewer, competitionKey: string, clubSourceId: string) {
  if (!canReadClub(viewer, competitionKey, clubSourceId)) throw new McpAccessError(403, "FORBIDDEN", "Akses klub pada kompetisi ini belum diberikan oleh admin.");
}
export function requireMcpAdmin(viewer: ReportViewer) {
  if (!viewer.isAdmin) throw new McpAccessError(403, "ADMIN_REQUIRED", "Pemeriksaan kualitas data hanya tersedia untuk admin.");
}
export async function consumeMcpRateLimit(db: AuthDatabase, viewerId: string) {
  const now = Date.now(), stale = sql`${authRateLimits.lastRequest} <= ${now - 60_000}`;
  const [row] = await db.insert(authRateLimits).values({ id: crypto.randomUUID(), key: `mcp:${viewerId}`, count: 1, lastRequest: now })
    .onConflictDoUpdate({ target: authRateLimits.key, set: { count: sql`case when ${stale} then 1 else ${authRateLimits.count} + 1 end`, lastRequest: sql`case when ${stale} then ${now} else ${authRateLimits.lastRequest} end` } }).returning();
  if (!row || row.count > 60) throw new McpAccessError(429, "RATE_LIMITED", "Batas permintaan tercapai. Coba lagi dalam satu menit.");
}
/** Disconnect only this user's connection; permission to another account cannot be supplied by a form. */
export async function revokeMcpConnection(db: AuthDatabase, viewerId: string, clientId: string) {
  z.string().min(1).max(2048).parse(clientId);
  await db.transaction(async tx => {
    await tx.delete(authMcpConsents).where(and(eq(authMcpConsents.userId, viewerId), eq(authMcpConsents.clientId, clientId)));
    await tx.update(authMcpRefreshTokens).set({ revoked: new Date() }).where(and(eq(authMcpRefreshTokens.userId, viewerId), eq(authMcpRefreshTokens.clientId, clientId)));
    await tx.update(authMcpAccessTokens).set({ revoked: new Date() }).where(and(eq(authMcpAccessTokens.userId, viewerId), eq(authMcpAccessTokens.clientId, clientId)));
  });
}
