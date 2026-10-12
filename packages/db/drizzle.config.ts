import { loadProjectEnv } from "./src/environment.js";
import { defineConfig } from "drizzle-kit";

loadProjectEnv();
const directUrl = process.env["DIRECT_DATABASE_URL"];
if (process.argv.includes("migrate") && !directUrl) {
  throw new Error("DIRECT_DATABASE_URL belum tersedia. Isi koneksi Neon StatsArena di .env root atau environment sebelum migrasi.");
}

export default defineConfig({
  dialect: "postgresql",
  schema: "./src/schema.ts",
  out: "./drizzle",
  schemaFilter: ["statsarena"],
  migrations: { schema: "statsarena", table: "__drizzle_migrations" },
  ...(directUrl ? { dbCredentials: { url: directUrl } } : {})
});
