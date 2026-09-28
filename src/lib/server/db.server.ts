import path from "node:path";
import { drizzle as drizzlePg, type NodePgDatabase } from "drizzle-orm/node-postgres";
import pg from "pg";
import * as schema from "./schema";

/**
 * The user database. Production uses a hosted Postgres from DATABASE_URL.
 * Without one, local development gets an embedded Postgres (PGlite) stored in
 * data/userdb, so the app runs with no setup. Production refuses to start
 * without DATABASE_URL rather than silently keeping accounts on a disk that
 * a redeploy wipes.
 */
export type Db = NodePgDatabase<typeof schema>;

let _db: Promise<Db> | null = null;

export function getUserDb(): Promise<Db> {
  _db ??= open();
  return _db;
}

async function open(): Promise<Db> {
  const url = process.env.DATABASE_URL;
  if (url) {
    const pool = new pg.Pool({
      connectionString: url,
      max: Number(process.env.DATABASE_POOL_MAX) || 5,
      // Hosted Postgres (Neon, Render, Supabase) requires TLS.
      ssl: /localhost|127\.0\.0\.1/.test(url) ? undefined : { rejectUnauthorized: true },
      // Neon closes idle connections and suspends the database when quiet.
      // Let idle connections go first, and don't wait forever to reconnect.
      idleTimeoutMillis: 10_000,
      connectionTimeoutMillis: 15_000,
      keepAlive: true,
    });
    // A connection the server drops while idle surfaces here; without a
    // listener it would crash the whole process. The pool replaces it.
    pool.on("error", (err) => console.error("Postgres idle connection error:", err.message));
    return drizzlePg(pool, { schema });
  }
  if (process.env.NODE_ENV === "production") {
    throw new Error("DATABASE_URL is not set. Accounts need a persistent Postgres database.");
  }
  const { PGlite } = await import("@electric-sql/pglite");
  const { drizzle: drizzleLite } = await import("drizzle-orm/pglite");
  const { migrate } = await import("drizzle-orm/pglite/migrator");
  const client = new PGlite(path.join(process.cwd(), "data", "userdb"));
  const db = drizzleLite(client, { schema });
  // Local only: keep the embedded database's schema current automatically.
  await migrate(db, { migrationsFolder: path.join(process.cwd(), "drizzle") });
  // PGlite and node-postgres expose the same query builder.
  return db as unknown as Db;
}
