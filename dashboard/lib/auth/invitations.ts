import { createHash, randomBytes } from "node:crypto";
import { and, eq, isNull } from "drizzle-orm";
import { z } from "zod";
import { authClubAccess, authInvitations, authUsers } from "@statsarena/db";
import { createReportAuth, type AuthDatabase } from "./factory";
import { grantSchema, normalizeEmail, type ClubGrant } from "./policy";
import type { AuthSettings } from "./settings";

const tokenSchema = z.string().regex(/^[A-Za-z0-9_-]{43}$/);
export const hashInvitation = (token: string) => createHash("sha256").update(tokenSchema.parse(token)).digest("hex");
export class InvitationError extends Error {}
function available(invite: typeof authInvitations.$inferSelect | undefined) {
  if (!invite || invite.acceptedAt || invite.revokedAt || invite.expiresAt.getTime() <= Date.now()) throw new InvitationError("Undangan tidak tersedia, sudah dipakai, atau kedaluwarsa.");
  return { ...invite, grants: z.array(grantSchema).max(100).parse(invite.grants) };
}
export async function invitationPreview(db: AuthDatabase, token: string) {
  if (!tokenSchema.safeParse(token).success) throw new InvitationError("Undangan tidak valid.");
  const [row] = await db.select().from(authInvitations).where(eq(authInvitations.tokenHash, hashInvitation(token))).limit(1);
  const invite = available(row);
  return { email: invite.email, grants: invite.grants, makeAdmin: invite.makeAdmin, expiresAt: invite.expiresAt };
}
async function assertAdmin(db: AuthDatabase, userId: string) {
  const [actor] = await db.select({ isAdmin: authUsers.isAdmin }).from(authUsers).where(eq(authUsers.id, userId));
  if (!actor?.isAdmin) throw new InvitationError("Akses admin diperlukan.");
}
export async function createStaffInvitation(db: AuthDatabase, settings: AuthSettings, actorId: string, email: string, grants: ClubGrant[], allowed: readonly ClubGrant[]) {
  await assertAdmin(db, actorId);
  const parsed = z.array(grantSchema).min(1).max(100).parse(grants);
  if (new Set(parsed.map(g => `${g.competitionKey}:${g.clubSourceId}`)).size !== parsed.length || parsed.some(g => !allowed.some(a => a.competitionKey === g.competitionKey && a.clubSourceId === g.clubSourceId))) throw new InvitationError("Pilihan klub tidak valid.");
  const token = randomBytes(32).toString("base64url");
  const expiresAt = new Date(Date.now() + 72 * 60 * 60 * 1000);
  await db.insert(authInvitations).values({ email: normalizeEmail(email), tokenHash: hashInvitation(token), grants: parsed, makeAdmin: false, createdByUserId: actorId, expiresAt });
  return { url: `${settings.baseURL.replace(/\/$/, "")}/invite/${token}`, expiresAt };
}
export async function revokeInvitation(db: AuthDatabase, actorId: string, id: string) {
  await assertAdmin(db, actorId);
  await db.update(authInvitations).set({ revokedAt: new Date() }).where(and(eq(authInvitations.id, z.uuid().parse(id)), isNull(authInvitations.acceptedAt), isNull(authInvitations.revokedAt)));
}
export async function revokeClubAccess(db: AuthDatabase, actorId: string, grantId: string) {
  await assertAdmin(db, actorId);
  await db.delete(authClubAccess).where(eq(authClubAccess.id, z.uuid().parse(grantId)));
}

/** User, credential hash, grants and single-use claim commit together or roll back together. */
export async function acceptInvitation(db: AuthDatabase, settings: AuthSettings, token: string, input: { name?: string; password?: string; existingUserId?: string }) {
  const tokenHash = hashInvitation(token);
  return db.transaction(async tx => {
    const [row] = await tx.select().from(authInvitations).where(eq(authInvitations.tokenHash, tokenHash)).for("update");
    const invite = available(row);
    let userId: string;
    if (input.existingUserId) {
      const [user] = await tx.select().from(authUsers).where(eq(authUsers.id, input.existingUserId));
      if (!user || normalizeEmail(user.email) !== invite.email) throw new InvitationError("Masuk dengan email yang menerima undangan ini.");
      userId = user.id;
    } else {
      const [existing] = await tx.select({ id: authUsers.id }).from(authUsers).where(eq(authUsers.email, invite.email));
      if (existing) throw new InvitationError("Email ini sudah memiliki akun. Masuk dahulu, lalu buka kembali undangan.");
      const body = z.object({ name: z.string().trim().min(2).max(100), password: z.string().min(12).max(128) }).parse(input);
      const created = await createReportAuth(tx, settings, true).api.signUpEmail({ body: { ...body, email: invite.email } });
      userId = created.user.id;
    }
    // The bearer invitation proves access to the admin-delivered enrollment link; no public signup exists.
    if (invite.makeAdmin) await tx.update(authUsers).set({ isAdmin: true }).where(eq(authUsers.id, userId));
    if (invite.grants.length) await tx.insert(authClubAccess).values(invite.grants.map(g => ({ ...g, userId }))).onConflictDoNothing();
    await tx.update(authInvitations).set({ acceptedAt: new Date() }).where(eq(authInvitations.id, invite.id));
    return { userId, email: invite.email };
  });
}
