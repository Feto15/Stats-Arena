/** Only provider continuations and the exact registered callback may receive an OAuth redirect. */
export function permittedOAuthRedirect(value: unknown, signedQuery: string, origin: string): value is string {
  if (typeof value !== "string" || value.length > 20000) return false;
  try {
    const url = new URL(value, origin), callback = new URL(new URLSearchParams(signedQuery).get("redirect_uri") ?? "");
    if (url.username || url.password || url.hash || !["https:", "http:"].includes(url.protocol) || (url.protocol === "http:" && !["localhost", "127.0.0.1", "[::1]"].includes(url.hostname))) return false;
    return (url.origin === new URL(origin).origin && ["/mcp/consent", "/mcp/login", "/api/auth/oauth2/authorize"].includes(url.pathname)) ||
      (url.origin === callback.origin && url.pathname === callback.pathname && [...callback.searchParams].every(([k,v]) => url.searchParams.get(k) === v));
  } catch { return false; }
}
