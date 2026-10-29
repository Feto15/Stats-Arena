import { getAuth, getAuthDatabase } from "@/lib/auth/runtime";
import { authSettings } from "@/lib/auth/settings";
import { createStatsArenaMcpRoute } from "@/lib/mcp/handler";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;
export async function POST(request: Request) {
  try { return await createStatsArenaMcpRoute(getAuth(), getAuthDatabase(), authSettings())(request); }
  catch { return Response.json({ error: "temporarily_unavailable" }, { status: 503, headers: { "cache-control": "private, no-store" } }); }
}
export function GET() { return new Response(null, { status: 405, headers: { allow: "POST", "cache-control": "private, no-store" } }); }
export const DELETE = GET;
