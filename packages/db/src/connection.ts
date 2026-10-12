import postgres from "postgres";
import { drizzle, type PostgresJsDatabase } from "drizzle-orm/postgres-js";
import { schema } from "./schema.js";

export type StatsArenaDatabase = PostgresJsDatabase<typeof schema>;

export function createDatabase(url = process.env["DATABASE_URL"]): {
  db: StatsArenaDatabase;
  close: () => Promise<void>;
} {
  if (!url) {
    throw new Error("DATABASE_URL belum tersedia; koneksi Neon tidak dapat dibuat.");
  }

  const parsed = new URL(url);
  if (!/^postgres(?:ql)?:$/.test(parsed.protocol)) {
    throw new Error("DATABASE_URL harus menggunakan protokol PostgreSQL.");
  }
  const host = parsed.hostname.toLowerCase();
  if (host.includes("ibl") || host.includes("analytic")) {
    throw new Error("Host database terindikasi milik proyek lain; importer StatsArena menolak koneksi ini.");
  }

  const client = postgres(url, {
    max: 4,
    prepare: false,
    connect_timeout: 10,
    idle_timeout: 20,
    max_lifetime: 60 * 30
  });
  return {
    db: drizzle({ client, schema }),
    close: async () => client.end({ timeout: 5 })
  };
}
