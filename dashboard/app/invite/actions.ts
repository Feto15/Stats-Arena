"use server";
import { getAuthDatabase, getViewer } from "@/lib/auth/server";
import { authSettings } from "@/lib/auth/settings";
import { acceptInvitation, InvitationError } from "@/lib/auth/invitations";
export async function activateInvitation(token: string, name: string, password: string) {
  try {
    const viewer = await getViewer();
    const result = await acceptInvitation(getAuthDatabase(), authSettings(), token, viewer ? { existingUserId: viewer.id } : { name, password });
    return { ok: true as const, email: result.email, signedIn: Boolean(viewer) };
  } catch (error) {
    return { ok: false as const, message: error instanceof InvitationError ? error.message : "Aktivasi belum berhasil. Periksa nama (minimal 2 karakter), password (12–128 karakter), dan masa berlaku undangan." };
  }
}
