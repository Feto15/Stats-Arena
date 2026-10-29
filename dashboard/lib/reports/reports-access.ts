import { isMcpEntryPath } from "../mcp/config";
export function isAdminPage(pathname: string) {
  const path = pathname.replace(/\/+$/, "") || "/";
  return path === "/" || /^\/(?:games|teams|players)(?:\/[^/]+)?$/.test(path) || ["/standings", "/review", "/admin/access", "/reports/bima-perkasa", "/reports/demo-match"].includes(path);
}
export function reportAccess(pathname: string, enabled: boolean, isAdmin = false): "allow" | "redirect" | "deny" {
  if (!enabled || isAdmin) return "allow";
  const path = pathname.replace(/\/+$/, "") || "/";
  if (isAdminPage(path)) return "redirect";
  if (isMcpEntryPath(path)) return "allow";
  if (path === "/login" || path === "/auth/continue" || /^\/invite\/[A-Za-z0-9_-]{43}$/.test(path) || path.startsWith("/api/auth/")) return "allow";
  if (path === "/reports" || path === "/icon.svg" || path === "/reports/genius-basketball-court.jpg" || path.startsWith("/_next/static/")) return "allow";
  return /^\/reports\/[a-z0-9]+(?:-[a-z0-9]+)*$/.test(path) ? "allow" : "deny";
}
