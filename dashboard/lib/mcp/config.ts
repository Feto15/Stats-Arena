export const MCP_PATH = "/api/mcp";
export const MCP_SCOPE = "statsarena:read";
export const MCP_VERSION = "1.0.0";
export const MCP_SCOPES = [MCP_SCOPE, "offline_access"];
export const mcpResource = (baseURL: string) => new URL(MCP_PATH, baseURL).href;

/** Public OAuth discovery aliases must reach the issuer's canonical provider path. */
export function mcpMetadataRequest(request: Request) {
  const url = new URL(request.url);
  if (/^\/\.well-known\/oauth-authorization-server(?:\/api\/auth)?$/.test(url.pathname)) url.pathname = "/.well-known/oauth-authorization-server/api/auth";
  return new Request(url, request);
}

/** Only transport/discovery/auth UI entry points bypass the reports-only page filter. */
export function isMcpEntryPath(path: string) {
  return [MCP_PATH, "/mcp/login", "/mcp/consent", "/mcp/connections"].includes(path) ||
    /^\/\.well-known\/(?:oauth-protected-resource(?:\/api\/mcp)?|oauth-authorization-server(?:\/api\/auth)?)$/.test(path);
}
