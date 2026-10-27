import { loadProjectEnv } from "@statsarena/db/env";
import { resolve } from "node:path";
import { z } from "zod";

const settingsSchema = z.object({ secret: z.string().min(32).refine(v => !v.startsWith("REPLACE_")), baseURL: z.url() }).superRefine((v, ctx) => {
  const u = new URL(v.baseURL);
  const local = ["localhost", "127.0.0.1", "[::1]"].includes(u.hostname);
  if ((u.protocol !== "https:" && !(local && u.protocol === "http:")) || u.username || u.password || u.pathname !== "/" || u.search || u.hash) ctx.addIssue({ code: "custom", message: "Invalid authentication origin." });
});
export type AuthSettings = z.infer<typeof settingsSchema>;
export function authSettings(): AuthSettings {
  // Next bundles import.meta.url; resolve the local root env like the existing dashboard data layer.
  loadProjectEnv(resolve(process.cwd(), "../.env"));
  const result = settingsSchema.safeParse({ secret: process.env["BETTER_AUTH_SECRET"], baseURL: process.env["BETTER_AUTH_URL"] });
  if (!result.success) throw new Error("Konfigurasi login belum tersedia atau tidak valid.");
  return result.data;
}
