import { betterAuth } from "better-auth/minimal";
import { drizzleAdapter } from "@better-auth/drizzle-adapter";
import { authUsers, authSessions, authAccounts, authVerifications, authRateLimits, schema, type StatsArenaDatabase } from "@statsarena/db";
import type { PgliteDatabase } from "drizzle-orm/pglite";
import type { AuthSettings } from "./settings";
import { jwt } from "better-auth/plugins";
import { mcp } from "@better-auth/mcp";
import { cimd } from "@better-auth/cimd";
import { fetchClientMetadataResource } from "@better-auth/cimd/node";
import { MCP_SCOPES, mcpResource } from "../mcp/config";

export type AuthDatabase = StatsArenaDatabase | PgliteDatabase<typeof schema>;
export type AuthTransaction = Parameters<Parameters<AuthDatabase["transaction"]>[0]>[0];

/** Signup is enabled only for the private instance inside an invitation transaction. */
export function createReportAuth(db: AuthDatabase | AuthTransaction, settings: AuthSettings, enrollment = false, metadataTransport: typeof fetchClientMetadataResource = fetchClientMetadataResource) {
  return betterAuth({
    appName: "StatsArena", secret: settings.secret, baseURL: settings.baseURL,
    trustedOrigins: [settings.baseURL],
    database: drizzleAdapter(db, { provider: "pg", schema: { user: authUsers, session: authSessions, account: authAccounts, verification: authVerifications, rateLimit: authRateLimits,
      jwks: schema.authMcpJwks, oauthClient: schema.authMcpClients, oauthResource: schema.authMcpResources,
      oauthClientResource: schema.authMcpClientResources, oauthAccessToken: schema.authMcpAccessTokens,
      oauthRefreshToken: schema.authMcpRefreshTokens, oauthConsent: schema.authMcpConsents, oauthClientAssertion: schema.authMcpClientAssertions }, transaction: true }),
    plugins: [jwt({ jwt: { issuer: `${settings.baseURL.replace(/\/$/, "")}/api/auth` } }),
      mcp({ resource: mcpResource(settings.baseURL), loginPage: "/mcp/login", consentPage: "/mcp/consent", scopes: MCP_SCOPES,
        grantTypes: ["authorization_code", "refresh_token"], accessTokenExpiresIn: 300, refreshTokenExpiresIn: 604800,
        allowDynamicClientRegistration: false, allowUnauthenticatedClientRegistration: false,
        clientPrivileges: ({ user }) => user?.["isAdmin"] === true }),
      cimd({ fetchClientMetadataResource: metadataTransport, metadataProfile: "mcp-2026-07-28",
        isMetadataDocumentUrlAllowed: value => new URL(value).origin === "https://chatgpt.com",
        metadataFetchPolicy: { maximumConcurrentFetches: 4, maximumFetchesPerMinute: 30 }, maxCacheEntries: 100 })],
    emailAndPassword: { enabled: true, disableSignUp: !enrollment, autoSignIn: false, minPasswordLength: 12, maxPasswordLength: 128 },
    user: { additionalFields: { isAdmin: { type: "boolean", defaultValue: false, input: false } }, changeEmail: { enabled: false } },
    session: { expiresIn: 60 * 60 * 24 * 7, updateAge: 60 * 60 * 24, cookieCache: { enabled: false } },
    advanced: { cookiePrefix: "statsarena", useSecureCookies: new URL(settings.baseURL).protocol === "https:" },
    rateLimit: { enabled: true, storage: "database", window: 60, max: 60, customRules: { "/sign-in/email": { window: 60, max: 5 } } },
    telemetry: { enabled: false }, logger: { disabled: true }
  });
}
