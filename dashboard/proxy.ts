import { NextResponse, type NextRequest } from "next/server";
import { isAdminPage, reportAccess } from "./lib/reports/reports-access";
import { getAuth } from "./lib/auth/runtime";
import { isMcpEntryPath } from "./lib/mcp/config";

export async function proxy(request: NextRequest) {
  const limited = process.env["STATSARENA_REPORTS_ONLY"] === "1";
  let decision = reportAccess(request.nextUrl.pathname, limited);
  if (limited && decision !== "allow" && request.headers.get("cookie")) {
    try {
      const session = await getAuth().api.getSession({ headers: request.headers });
      decision = reportAccess(request.nextUrl.pathname, limited, session?.user.isAdmin === true);
    } catch { /* Keep the restricted decision when session verification is unavailable. */ }
  }
  if (decision === "redirect") return NextResponse.redirect(new URL("/reports", request.url));
  if (decision === "deny") return new NextResponse('<!doctype html><html lang="id"><head><meta name="robots" content="noindex"><title>Halaman tidak tersedia</title></head><body><h1>Halaman tidak tersedia</h1><p><a href="/reports">Buka laporan klub</a></p></body></html>', { status: 404, headers: { "content-type": "text/html; charset=utf-8", "cache-control": "private, no-store" } });
  const response = NextResponse.next();
  if (isMcpEntryPath(request.nextUrl.pathname) || isAdminPage(request.nextUrl.pathname) || request.nextUrl.pathname.startsWith("/reports") || request.nextUrl.pathname.startsWith("/admin") || request.nextUrl.pathname.startsWith("/invite") || request.nextUrl.pathname.startsWith("/api/auth") || request.nextUrl.pathname.startsWith("/auth") || request.nextUrl.pathname === "/login") {
    response.headers.set("cache-control", "private, no-store");
    response.headers.set("referrer-policy", "no-referrer");
    response.headers.set("x-robots-tag", "noindex, nofollow");
  }
  return response;
}
export const config = { matcher: "/:path*" };
