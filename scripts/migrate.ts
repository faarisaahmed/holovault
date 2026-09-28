import path from "node:path";

/**
 * Applies drizzle/ migrations to the user database. Runs before the server
 * starts, so a deploy never serves code against an out-of-date schema.
 */
async function main() {
  const folder = path.join(process.cwd(), "drizzle");
  if (process.env.DATABASE_URL) {
    const pg = (await import("pg")).default;
    const { drizzle } = await import("drizzle-orm/node-postgres");
    const { migrate } = await import("drizzle-orm/node-postgres/migrator");
    const url = process.env.DATABASE_URL;
    const pool = new pg.Pool({
      connectionString: url,
      ssl: /localhost|127\.0\.0\.1/.test(url) ? undefined : { rejectUnauthorized: true },
    });
    await migrate(drizzle(pool), { migrationsFolder: folder });
    await pool.end();
  } else {
    const { PGlite } = await import("@electric-sql/pglite");
    const { drizzle } = await import("drizzle-orm/pglite");
    const { migrate } = await import("drizzle-orm/pglite/migrator");
    const client = new PGlite(path.join(process.cwd(), "data", "userdb"));
    await migrate(drizzle(client), { migrationsFolder: folder });
    await client.close();
  }
  console.log("migrations applied");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
