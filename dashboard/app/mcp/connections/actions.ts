"use server";
import { revalidatePath } from "next/cache";
import { getAuthDatabase, requireViewer } from "@/lib/auth/server";
import { revokeMcpConnection } from "@/lib/mcp/access";
export async function disconnectMcpAction(form: FormData) {
  const viewer = await requireViewer();
  const client = form.get("clientId");
  if (typeof client !== "string") throw new Error("Koneksi tidak valid.");
  await revokeMcpConnection(getAuthDatabase(), viewer.id, client);
  revalidatePath("/mcp/connections");
}
