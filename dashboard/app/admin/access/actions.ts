"use server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { getAuthDatabase, requireAdmin } from "@/lib/auth/server";
import { authSettings } from "@/lib/auth/settings";
import { createStaffInvitation, revokeClubAccess, revokeInvitation } from "@/lib/auth/invitations";
import { readReportCatalog } from "@/lib/reports/neon-server";
export async function createInvitationAction(form: FormData) {
  const actor = await requireAdmin();
  try {
    const data = await readReportCatalog();
    const ids = z.array(z.string()).min(1).max(data.clubs.length).parse(form.getAll("club"));
    const grants = ids.map(clubSourceId => ({ competitionKey: data.competition.key, clubSourceId }));
    const allowed = data.clubs.map(c => ({ competitionKey: data.competition.key, clubSourceId: c.sourceId }));
    const result = await createStaffInvitation(getAuthDatabase(), authSettings(), actor.id, z.string().parse(form.get("email")), grants, allowed);
    revalidatePath("/admin/access");
    return { ok: true as const, url: result.url, expiresAt: result.expiresAt.toISOString() };
  } catch { return { ok: false as const, message: "Undangan belum dapat dibuat. Periksa email dan pilih minimal satu klub." }; }
}
export async function cancelInvitationAction(form: FormData) {
  const actor = await requireAdmin();
  await revokeInvitation(getAuthDatabase(), actor.id, z.string().parse(form.get("id")));
  revalidatePath("/admin/access");
}
export async function removeClubAccessAction(form: FormData) {
  const actor = await requireAdmin();
  await revokeClubAccess(getAuthDatabase(), actor.id, z.string().parse(form.get("id")));
  revalidatePath("/admin/access"); revalidatePath("/reports");
}
