import assert from "node:assert/strict";
import test from "node:test";
import { createHash, randomBytes } from "node:crypto";
import { fileURLToPath } from "node:url";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { Client, StreamableHTTPClientTransport } from "@modelcontextprotocol/client";
import { schema, authUsers, authClubAccess, authMcpClients, authMcpConsents } from "@statsarena/db";
import type { StatsArenaDatabase } from "@statsarena/db";
import { createReportAuth } from "../lib/auth/factory";
import { createStatsArenaMcpRoute } from "../lib/mcp/handler";
import { loadMcpViewer, revokeMcpConnection } from "../lib/mcp/access";
import { MCP_SCOPE, mcpResource, mcpMetadataRequest } from "../lib/mcp/config";
import { verifiedOAuthQuery } from "../lib/mcp/oauth-flow";

const settings = { baseURL: "http://localhost:3401", secret: "test-only-mcp-auth-secret-at-least-32-characters" };
const password = "test-only-mcp-password-2026!";
const object = z.record(z.string(), z.unknown());
async function redirectFrom(response: Response) {
  const location = response.headers.get("location");
  if (location) return new URL(location, settings.baseURL);
  const body = object.parse(await response.json());
  assert.equal(response.status, 200, `OAuth request failed with status ${response.status}: ${String(body["error"] ?? body["code"] ?? "unknown")}`);
  return new URL(z.string().parse(body["url"]), settings.baseURL);
}
async function rpcBody(response: Response) {
  const text = await response.text();
  return object.parse(JSON.parse(response.headers.get("content-type")?.includes("text/event-stream") ? text.split("\n").find(line => line.startsWith("data:"))!.slice(5) : text));
}

test("MCP OAuth PKCE, consent, bearer transport and live permission revocation use real Better Auth and PostgreSQL", async t => {
  const client = new PGlite(), db = drizzle(client, { schema });
  await migrate(db, { migrationsFolder: fileURLToPath(new URL("../../packages/db/drizzle", import.meta.url)), migrationsSchema: "statsarena", migrationsTable: "__drizzle_migrations" });
  const auth = createReportAuth(db, settings), enrollment = createReportAuth(db, settings, true), resource = mcpResource(settings.baseURL);
  const initialFetch = globalThis.fetch;
  const request = (path: string, body?: Record<string, unknown>, cookie = "") => auth.handler(new Request(`${settings.baseURL}${path}`, { method: body ? "POST" : "GET", headers: { origin: settings.baseURL, ...(cookie ? { cookie } : {}), ...(body ? { "content-type": "application/json" } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) }));
  let adminCookie = "", staffCookie = "", userId = "", clientId = "", accessToken = "", refreshToken = "";
  const verifier = randomBytes(32).toString("base64url"), challenge = createHash("sha256").update(verifier).digest("base64url");
  const route = createStatsArenaMcpRoute(auth, db as unknown as StatsArenaDatabase, settings);
  const rpc = (method: string, params: unknown, token = accessToken, extra: Record<string,string> = {}) => route(new Request(resource, { method: "POST", headers: { "content-type": "application/json", accept: "application/json, text/event-stream", "mcp-protocol-version": "2025-11-25", ...(token ? { authorization: `Bearer ${token}` } : {}), ...extra }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }) }));
  const tokenRequest = (body: Record<string,string>) => auth.handler(new Request(`${settings.baseURL}/api/auth/oauth2/token`, { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: new URLSearchParams(body) }));
  try {
    globalThis.fetch = async (input, init) => {
      const request = new Request(input, init);
      if (request.url === `${settings.baseURL}/api/auth/jwks`) return auth.handler(request);
      throw new Error("Unexpected network request in offline MCP test");
    };
    await t.test("schema supports invitation-only auth, current grants and admin-only OAuth client creation", async () => {
      const admin = await enrollment.api.signUpEmail({ body: { email: "admin@example.test", password, name: "Admin" } });
      const staff = await enrollment.api.signUpEmail({ body: { email: "coach@example.test", password, name: "Coach" } });
      userId = staff.user.id;
      await db.update(authUsers).set({ isAdmin: true }).where(eq(authUsers.id, admin.user.id));
      await db.insert(authClubAccess).values({ userId, competitionKey: "IBL:50231", clubSourceId: "126042" });
      for (const [email, assign] of [["admin@example.test", (cookie: string) => { adminCookie = cookie; }], ["coach@example.test", (cookie: string) => { staffCookie = cookie; }]] as const) {
        const response = await request("/api/auth/sign-in/email", { email, password }); assert.equal(response.status, 200);
        assign(response.headers.getSetCookie().map(c => c.split(";")[0]).join("; "));
      }
      const registration = { client_name: "StatsArena test client", redirect_uris: ["https://chatgpt.com/connector_platform_oauth_redirect"], token_endpoint_auth_method: "none", scope: `${MCP_SCOPE} offline_access`, grant_types: ["authorization_code", "refresh_token"], resources: [resource] };
      assert.ok([401, 403].includes((await request("/api/auth/oauth2/create-client", registration, staffCookie)).status));
      const response = await request("/api/auth/oauth2/create-client", registration, adminCookie);
      const body = object.parse(await response.json()); assert.equal(response.status, 201, `Client creation failed: ${String(body["error"] ?? body["code"])}`);
      clientId = z.string().parse(body["client_id"]);
      assert.ok((await request("/api/auth/sign-up/email", { email: "uninvited@example.test", name: "No", password })).status >= 400);
    });
    await t.test("discovery advertises canonical issuer, resource and CIMD; missing/forged bearer and foreign origins are denied", async () => {
      const response = await request("/.well-known/oauth-protected-resource/api/mcp"); assert.equal(response.status, 200);
      const metadata = object.parse(await response.json()); assert.equal(metadata["resource"], resource);
      const discovery = await request("/.well-known/oauth-authorization-server/api/auth"); assert.equal(discovery.status, 200);
      for (const path of ["/.well-known/oauth-authorization-server"]) {
        const metadata = await auth.handler(mcpMetadataRequest(new Request(settings.baseURL + path)));
        assert.equal(metadata.status, 200);
        assert.equal(object.parse(await metadata.json())["issuer"], settings.baseURL + "/api/auth");
      }
      const issuer = object.parse(await discovery.json()); assert.equal(issuer["issuer"], `${settings.baseURL}/api/auth`); assert.equal(issuer["client_id_metadata_document_supported"], true);
      assert.equal(issuer["registration_endpoint"], undefined);
      const anonymous = await rpc("tools/list", {}, ""); assert.equal(anonymous.status, 401); assert.match(anonymous.headers.get("www-authenticate") ?? "", /oauth-protected-resource/);
      assert.equal((await rpc("tools/list", {}, "forged-token")).status, 401);
      assert.equal((await rpc("tools/list", {}, "", { origin: "https://foreign.invalid" })).status, 403);
    });
    await t.test("ChatGPT CIMD registers through discovery while unrelated metadata URLs are rejected before fetching", async () => {
      let fetches = 0;
      const metadataAuth = createReportAuth(db, settings, false, async input => {
        fetches++; assert.equal(String(input), "https://chatgpt.com/oauth/client.json");
        return Response.json({ client_id: "https://chatgpt.com/oauth/client.json", client_name: "ChatGPT", redirect_uris: ["https://chatgpt.com/connector_platform_oauth_redirect"], token_endpoint_auth_method: "none", grant_types: ["authorization_code", "refresh_token"] });
      });
      const authorize = (clientId: string) => metadataAuth.handler(new Request(`${settings.baseURL}/api/auth/oauth2/authorize?${new URLSearchParams({ client_id: clientId, response_type: "code", redirect_uri: "https://chatgpt.com/connector_platform_oauth_redirect", resource, scope: MCP_SCOPE, code_challenge: challenge, code_challenge_method: "S256" })}`));
      const login = await redirectFrom(await authorize("https://chatgpt.com/oauth/client.json")); assert.equal(login.pathname, "/mcp/login"); assert.equal(fetches, 1);
      await authorize("http://127.0.0.1/metadata.json"); await authorize("https://foreign.invalid/client.json"); assert.equal(fetches, 1);
    });
    let authorizationCode = "";
    await t.test("authorization creates expiring signed login/consent queries; PKCE and explicit consent issue an audience-bound user token", async () => {
      const query = new URLSearchParams({ response_type: "code", client_id: clientId, redirect_uri: "https://chatgpt.com/connector_platform_oauth_redirect", scope: `${MCP_SCOPE} offline_access`, resource, code_challenge: challenge, code_challenge_method: "S256", state: "test-state" });
      const login = await redirectFrom(await request(`/api/auth/oauth2/authorize?${query}`)); assert.equal(login.pathname, "/mcp/login");
      await verifiedOAuthQuery(login.search.slice(1), settings);
      const signedLogin = login.search.slice(1);
      const signIn = await request("/api/auth/sign-in/email", { email: "coach@example.test", password, oauth_query: signedLogin });
      staffCookie = signIn.headers.getSetCookie().map(c => c.split(";")[0]).join("; ");
      const consent = await redirectFrom(signIn); assert.equal(consent.pathname, "/mcp/consent");
      await verifiedOAuthQuery(consent.search.slice(1), settings);
      const callback = await redirectFrom(await request("/api/auth/oauth2/consent", { accept: true, oauth_query: consent.search.slice(1) }, staffCookie));
      authorizationCode = z.string().parse(callback.searchParams.get("code")); assert.equal(callback.searchParams.get("state"), "test-state");
      const response = await tokenRequest({ grant_type: "authorization_code", code: authorizationCode, client_id: clientId, code_verifier: verifier, resource, redirect_uri: "https://chatgpt.com/connector_platform_oauth_redirect" });
      const body = object.parse(await response.json()); assert.equal(response.status, 200, `Token exchange failed: ${String(body["error"] ?? body["code"])}`);
      accessToken = z.string().parse(body["access_token"]); refreshToken = z.string().parse(body["refresh_token"]);
      const claims = JSON.parse(Buffer.from(accessToken.split(".")[1]!, "base64url").toString("utf8")) as unknown;
      assert.equal(object.parse(claims)["aud"], resource); assert.equal(object.parse(claims)["sub"], userId);
      assert.equal((await loadMcpViewer(db, claims, resource)).grants.length, 1);
      assert.ok((await db.select().from(authMcpConsents)).length);
    });
    await t.test("real MCP lists only read-only tools and resolves profile from the token rather than forged arguments", async () => {
      const list = await rpc("tools/list", {}); assert.equal(list.status, 200);
      const body = await rpcBody(list), result = object.parse(body["result"]), tools = z.array(object).parse(result["tools"]);
      assert.equal(tools.length, 9); assert.ok(tools.every(tool => object.parse(tool["annotations"])["readOnlyHint"] === true));
      assert.ok(tools.every(tool => tool["name"] !== "get_data_quality"));
      const deniedQuality = await rpcBody(await rpc("tools/call", { name: "get_data_quality", arguments: { competition: "IBL:50231", club: "126042" } }));
      assert.ok(deniedQuality["error"] || object.parse(deniedQuality["result"])["isError"] === true);
      await db.update(authUsers).set({ isAdmin: true }).where(eq(authUsers.id, userId));
      const adminTools = z.array(object).parse(object.parse((await rpcBody(await rpc("tools/list", {})))["result"])["tools"]);
      assert.equal(adminTools.length, 10); assert.ok(adminTools.some(tool => tool["name"] === "get_data_quality"));
      await db.update(authUsers).set({ isAdmin: false }).where(eq(authUsers.id, userId));
      const demotedTools = z.array(object).parse(object.parse((await rpcBody(await rpc("tools/list", {})))["result"])["tools"]);
      assert.ok(demotedTools.every(tool => tool["name"] !== "get_data_quality"));
      const profile = await rpcBody(await rpc("tools/call", { name: "get_profile", arguments: {} }));
      const profileResult = object.parse(profile["result"]); assert.equal(object.parse(profileResult["structuredContent"])["id"], userId);
      const forged = await rpcBody(await rpc("tools/call", { name: "get_profile", arguments: { userId: "admin", isAdmin: true } }));
      assert.ok(forged["error"] || object.parse(forged["result"])["isError"] === true);
      const forbidden = await rpcBody(await rpc("tools/call", { name: "get_team_stats", arguments: { competition: "IBL:50231", club: "99999" } }));
      assert.equal(object.parse(object.parse(object.parse(forbidden["result"])["structuredContent"])["error"])["code"], "FORBIDDEN");
    });
    await t.test("official SDK negotiates MCP 2026-07-28 and calls tools over the protected HTTP handler", async () => {
      const methods: string[] = [];
      const transport = new StreamableHTTPClientTransport(new URL(resource), { requestInit: { headers: { authorization: `Bearer ${accessToken}` } }, fetch: async (url, init) => {
        const request = new Request(url, init);
        if (request.method === "POST") { const body = object.parse(await request.clone().json()); if (typeof body["method"] === "string") methods.push(body["method"]); }
        return route(request);
      } });
      const sdk = new Client({ name: "StatsArena test", version: "1" }, { versionNegotiation: { mode: { pin: "2026-07-28" } } });
      try {
        await sdk.connect(transport);
        assert.equal((await sdk.listTools()).tools.length, 9);
        const result = await sdk.callTool({ name: "get_profile", arguments: {} });
        assert.equal(object.parse(result.structuredContent)["id"], userId);
        assert.ok(methods.includes("server/discover"));
      } finally { await sdk.close(); }
      assert.equal((await rpc("tools/call", { name: "get_profile", arguments: { excess: "x".repeat(70_000) } })).status, 413);
    });
    await t.test("authorization codes cannot be replayed; unsigned continuations and wildcard redirects fail", async () => {
      assert.ok((await tokenRequest({ grant_type: "authorization_code", code: authorizationCode, client_id: clientId, code_verifier: verifier, resource, redirect_uri: "https://chatgpt.com/connector_platform_oauth_redirect" })).status >= 400);
      await assert.rejects(() => verifiedOAuthQuery("client_id=forged&resource=foreign", settings));
      const bad = await request(`/api/auth/oauth2/authorize?${new URLSearchParams({ response_type: "code", client_id: clientId, redirect_uri: "https://foreign.invalid/callback", scope: MCP_SCOPE, resource, code_challenge: challenge, code_challenge_method: "S256" })}`, undefined, staffCookie);
      assert.notEqual(bad.headers.get("location")?.startsWith("https://foreign.invalid"), true);
      const errorLocation = new URL(bad.headers.get("location") ?? "/", settings.baseURL);
      assert.ok(bad.status >= 400 || (errorLocation.origin === settings.baseURL && errorLocation.pathname === "/api/auth/error"));
      const query = new URLSearchParams({ response_type: "code", client_id: clientId, redirect_uri: "https://chatgpt.com/connector_platform_oauth_redirect", scope: MCP_SCOPE, resource, code_challenge: challenge, code_challenge_method: "S256" });
      const callback = await redirectFrom(await request(`/api/auth/oauth2/authorize?${query}`, undefined, staffCookie));
      const invalidPkce = await tokenRequest({ grant_type: "authorization_code", code: callback.searchParams.get("code")!, client_id: clientId, code_verifier: "wrong-verifier-that-is-long-enough-for-pkce-test", resource, redirect_uri: "https://chatgpt.com/connector_platform_oauth_redirect" });
      assert.equal(invalidPkce.status, 400);
      const before = object.parse(JSON.parse(Buffer.from(accessToken.split(".")[1]!, "base64url").toString("utf8")));
      const signedWrongAudience = await auth.api.signJWT({ body: { payload: { sub: userId, sid: z.string().parse(before["sid"]), client_id: clientId, scope: MCP_SCOPE, aud: "https://foreign.invalid/api/mcp" } } });
      assert.equal((await rpc("tools/list", {}, signedWrongAudience.token)).status, 401);
    });
    await t.test("same bearer loses its club grant immediately; disconnect invalidates access and refresh", async () => {
      await db.delete(authClubAccess).where(eq(authClubAccess.userId, userId));
      const body = await rpcBody(await rpc("tools/call", { name: "get_profile", arguments: {} }));
      assert.deepEqual(object.parse(object.parse(body["result"])["structuredContent"])["grants"], []);
      const forbidden = await rpcBody(await rpc("tools/call", { name: "get_team_stats", arguments: { competition: "IBL:50231", club: "126042" } }));
      assert.equal(object.parse(object.parse(object.parse(forbidden["result"])["structuredContent"])["error"])["code"], "FORBIDDEN");
      await revokeMcpConnection(db, userId, clientId);
      assert.equal((await rpc("tools/list", {})).status, 401);
      assert.ok((await tokenRequest({ grant_type: "refresh_token", refresh_token: refreshToken, client_id: clientId, resource })).status >= 400);
      assert.ok((await db.select().from(authMcpClients)).length);
    });
  } finally { globalThis.fetch = initialFetch; await client.close(); }
});
