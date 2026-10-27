import { betterAuth } from "better-auth/minimal";
import { drizzleAdapter } from "@better-auth/drizzle-adapter";
import { authUsers, authSessions, authAccounts, authVerifications, authRateLimits, schema, type StatsArenaDatabase } from "@statsarena/db";
import type { PgliteDatabase } from "drizzle-orm/pglite";
import type { AuthSettings } from "./settings";

export type AuthDatabase = StatsArenaDatabase | PgliteDatabase<typeof schema>;
export type AuthTransaction = Parameters<Parameters<AuthDatabase["transaction"]>[0]>[0];

/** Signup is enabled only for the private instance inside an invitation transaction. */
export function createReportAuth(db: AuthDatabase | AuthTransaction, settings: AuthSettings, enrollment = false) {
  return betterAuth({
    appName: "StatsArena", secret: settings.secret, baseURL: settings.baseURL,
    trustedOrigins: [settings.baseURL],
    database: drizzleAdapter(db, { provider: "pg", schema: { user: authUsers, session: authSessions, account: authAccounts, verification: authVerifications, rateLimit: authRateLimits }, transaction: true }),
    emailAndPassword: { enabled: true, disableSignUp: !enrollment, autoSignIn: false, minPasswordLength: 12, maxPasswordLength: 128 },
    user: { additionalFields: { isAdmin: { type: "boolean", defaultValue: false, input: false } }, changeEmail: { enabled: false } },
    session: { expiresIn: 60 * 60 * 24 * 7, updateAge: 60 * 60 * 24, cookieCache: { enabled: false } },
    advanced: { cookiePrefix: "statsarena", useSecureCookies: new URL(settings.baseURL).protocol === "https:" },
    rateLimit: { enabled: true, storage: "database", window: 60, max: 60, customRules: { "/sign-in/email": { window: 60, max: 5 } } },
    telemetry: { enabled: false }, logger: { disabled: true }
  });
}
