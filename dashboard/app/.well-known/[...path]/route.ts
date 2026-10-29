import { getAuth } from "@/lib/auth/runtime";
import { isMcpEntryPath, mcpMetadataRequest } from "@/lib/mcp/config";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function GET(request: Request) {
  if (!isMcpEntryPath(new URL(request.url).pathname)) return new Response(null, { status: 404 });
  try {
    const response = await getAuth().handler(mcpMetadataRequest(request));
    response.headers.set("cache-control", "no-store");
    return response;
  } catch { return Response.json({ error: "temporarily_unavailable" }, { status: 503, headers: { "cache-control": "no-store" } }); }
}
