import { verifyOAuthQueryParams } from "@better-auth/oauth-provider";
import { MCP_SCOPES, mcpResource } from "./config";
import type { AuthSettings } from "../auth/settings";

export function oauthQuery(params: Record<string, string | string[] | undefined>) {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) for (const part of typeof value === "string" ? [value] : value ?? []) query.append(key, part);
  return query.toString();
}
/** OAuth continuation comes only from the provider's expiring, signed query, never a returnTo supplied by a model. */
export async function verifiedOAuthQuery(value: string, settings: AuthSettings) {
  if (value.length > 16384 || !await verifyOAuthQueryParams(value, settings.secret)) throw new Error("Permintaan koneksi tidak valid atau sudah kedaluwarsa.");
  const query = new URLSearchParams(value);
  if (query.getAll("resource").length !== 1 || query.get("resource") !== mcpResource(settings.baseURL) || !query.get("client_id") || !query.get("redirect_uri") ||
    (query.get("scope") ?? "").split(" ").some(s => !MCP_SCOPES.includes(s))) throw new Error("Permintaan koneksi tidak sesuai layanan StatsArena.");
  return query;
}
