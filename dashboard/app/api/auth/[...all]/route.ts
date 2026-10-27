import { getAuth } from "@/lib/auth/server";
export const runtime = "nodejs";
async function handler(request: Request) {
  try { return await getAuth().handler(request); }
  catch { return Response.json({ message: "Layanan login belum dapat digunakan. Coba lagi nanti." }, { status: 503, headers: { "cache-control": "private, no-store" } }); }
}
export const GET = handler;
export const POST = handler;
