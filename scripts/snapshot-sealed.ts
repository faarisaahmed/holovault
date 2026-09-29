import { getDb } from "../src/lib/db.server";
import { getUserDb } from "../src/lib/server/db.server";
import { recordCardPrices } from "../src/lib/server/prices.server";
import { sealedPrice } from "../src/lib/server/schema";

/**
 * Records today's market price for every priced sealed product (and every
 * owned or wanted card printing) into the user
 * database, building the price history the sealed charts and signals use.
 * Runs after each ingest (the daily rebuild). One row per product per day;
 * re-running the same day changes nothing.
 *
 * It never fails the build: prices not recorded today are a gap in a chart,
 * not a reason to keep the site down.
 */
async function main() {
  const rows = getDb()
    .prepare(`SELECT product_id, market, low FROM sealed_catalog WHERE market IS NOT NULL`)
    .all() as { product_id: number; market: number; low: number | null }[];
  const day = new Date().toISOString().slice(0, 10);
  const db = await getUserDb();
  let written = 0;
  for (let i = 0; i < rows.length; i += 500) {
    const chunk = rows.slice(i, i + 500).map((r) => ({
      productId: r.product_id,
      day,
      market: r.market.toFixed(2),
      low: r.low != null ? r.low.toFixed(2) : null,
    }));
    await db.insert(sealedPrice).values(chunk).onConflictDoNothing();
    written += chunk.length;
  }
  console.log(`sealed prices recorded for ${day}: ${written} products`);
  // Card prices for everything someone owns or wants: the weekly movers.
  console.log(`card prices recorded for ${day}: ${await recordCardPrices()} printings`);
  process.exit(0);
}

main().catch((err) => {
  console.warn(`WARNING: sealed price snapshot skipped: ${err instanceof Error ? err.message : String(err)}`);
  process.exit(0);
});
