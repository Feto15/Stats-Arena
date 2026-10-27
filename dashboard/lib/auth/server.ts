import "server-only";
import { cache } from "react";
import { headers } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { authClubAccess } from "@statsarena/db";
import { eq } from "drizzle-orm";
import { getAuth, getAuthDatabase } from "./runtime";
import { canReadClub, safeReturnTo, type ReportViewer } from "./policy";

export { getAuth, getAuthDatabase } from "./runtime";
export const getViewer = cache(async (): Promise<ReportViewer | null> => {
  const requestHeaders = await headers();
  if (!requestHeaders.get("cookie")) return null;
  const session = await getAuth().api.getSession({ headers: requestHeaders });
  if (!session) return null;
  const grants = await getAuthDatabase().select({ competitionKey: authClubAccess.competitionKey, clubSourceId: authClubAccess.clubSourceId }).from(authClubAccess).where(eq(authClubAccess.userId, session.user.id));
  return { id: session.user.id, name: session.user.name, email: session.user.email, isAdmin: session.user.isAdmin, grants };
});
export async function requireViewer(next = "/reports") {
  const viewer = await getViewer();
  if (!viewer) redirect(`/login?next=${encodeURIComponent(safeReturnTo(next))}`);
  return viewer;
}
export async function requireAdmin(next = "/") {
  const viewer = await requireViewer(next);
  if (!viewer.isAdmin) redirect("/reports");
  return viewer;
}
export async function requireClub(competitionKey: string, clubSourceId: string, next: string) {
  const viewer = await requireViewer(next);
  if (!canReadClub(viewer, competitionKey, clubSourceId)) notFound();
  return viewer;
}
