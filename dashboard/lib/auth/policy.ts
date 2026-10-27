import { z } from "zod";
import { isAdminPage } from "../reports/reports-access";

export const grantSchema = z.object({ competitionKey: z.string().regex(/^(?:IBL:)?[1-9]\d*$/), clubSourceId: z.string().regex(/^[1-9]\d*$/) });
export type ClubGrant = z.infer<typeof grantSchema>;
export type ReportViewer = { id: string; name: string; email: string; isAdmin: boolean; grants: ClubGrant[] };
export const normalizeEmail = (email: string) => z.email().max(254).parse(email.trim().toLowerCase());
export function canReadClub(viewer: ReportViewer, competitionKey: string, clubSourceId: string) {
  return viewer.isAdmin || viewer.grants.some(g => g.competitionKey === competitionKey && g.clubSourceId === clubSourceId);
}
function validReturnTo(value: unknown): string | null {
  if (typeof value !== "string" || value.length > 2048 || !value.startsWith("/") || value.startsWith("//") || /[\\\u0000-\u001f]/.test(value)) return null;
  const url = new URL(value, "https://statsarena.invalid");
  const allowed = isAdminPage(url.pathname) || url.pathname === "/reports" || /^\/invite\/[A-Za-z0-9_-]{43}$/.test(url.pathname) || /^\/reports\/[a-z0-9]+(?:-[a-z0-9]+)*$/.test(url.pathname);
  return url.origin === "https://statsarena.invalid" && allowed ? `${url.pathname}${url.search}` : null;
}
export const safeReturnTo = (value: unknown) => validReturnTo(value) ?? "/reports";
export function loginDestination(isAdmin: boolean, requested: unknown) {
  const target = validReturnTo(requested);
  if (!target || target === "/reports") return isAdmin ? "/" : "/reports";
  if (!isAdmin && isAdminPage(new URL(target, "https://statsarena.invalid").pathname)) return "/reports";
  return target;
}
export function loginContinuation(requested: unknown) {
  const target = validReturnTo(requested);
  return `/auth/continue${target ? `?next=${encodeURIComponent(target)}` : ""}`;
}
