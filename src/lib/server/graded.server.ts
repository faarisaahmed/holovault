import { inArray, sql } from "drizzle-orm";
import { getUserDb } from "./db.server";
import { gradedFetch, gradedPrice } from "./schema";

/**
 * PSA sold prices. The sibling Ripwise app already scrapes and caches
 * eBay comps (/api/psa/:cardId); this app asks it rather than scraping eBay a
 * second time, and keeps what it gets for a week. Without RIPWISE_URL,
 * or when eBay blocks Ripwise's host, cards simply have no comps and
 * the grading page falls back to break-even figures.
 */
const TTL_MS = 7 * 24 * 60 * 60 * 1000;

/** Ripwise's address; PULL_TRACKER_URL is its name from before the rename. */
function ripwiseUrl(): string | undefined {
  return (process.env.RIPWISE_URL || process.env.PULL_TRACKER_URL)?.replace(/\/$/, "");
}

export function gradedSourceConfigured(): boolean {
  return !!ripwiseUrl();
}

/** cardId -> grade ("10", "9") -> average sold price, from the cache only. */
export async function gradedPrices(cardIds: string[]): Promise<Map<string, Map<string, number>>> {
  const out = new Map<string, Map<string, number>>();
  if (!cardIds.length) return out;
  const db = await getUserDb();
  const rows = await db.select().from(gradedPrice).where(inArray(gradedPrice.cardId, [...new Set(cardIds)]));
  for (const r of rows) {
    const m = out.get(r.cardId) ?? new Map<string, number>();
    m.set(String(Number(r.grade)), Number(r.avgPrice));
    out.set(r.cardId, m);
  }
  return out;
}

/**
 * Looks up comps for cards not checked in the last week, a few at a time so
 * a page load never waits on dozens of slow scrapes.
 */
export async function refreshGraded(cardIds: string[], max = 6): Promise<number> {
  const base = ripwiseUrl();
  if (!base || !cardIds.length) return 0;
  const db = await getUserDb();
  const seen = await db
    .select()
    .from(gradedFetch)
    .where(inArray(gradedFetch.cardId, [...new Set(cardIds)]));
  const fresh = new Set(seen.filter((s) => Date.now() - s.fetchedAt.getTime() < TTL_MS).map((s) => s.cardId));
  const todo = [...new Set(cardIds)].filter((id) => !fresh.has(id)).slice(0, max);

  await Promise.all(
    todo.map(async (cardId) => {
      let status = "error";
      try {
        const res = await fetch(`${base}/api/psa/${encodeURIComponent(cardId)}`, {
          signal: AbortSignal.timeout(15_000),
        });
        const body = (await res.json()) as {
          status: string;
          grades?: { grade: string; avgPrice: number; salesCount: number }[];
        };
        status = body.status;
        for (const g of body.grades ?? []) {
          const row = { cardId, grade: g.grade, avgPrice: String(g.avgPrice), salesCount: g.salesCount, fetchedAt: new Date() };
          await db
            .insert(gradedPrice)
            .values(row)
            .onConflictDoUpdate({ target: [gradedPrice.cardId, gradedPrice.grade], set: row });
        }
      } catch {
        // Recorded below as "error" so a flaky upstream is retried next week, not every load.
      }
      await db
        .insert(gradedFetch)
        .values({ cardId, status, fetchedAt: new Date() })
        .onConflictDoUpdate({ target: gradedFetch.cardId, set: { status, fetchedAt: sql`now()` } });
    }),
  );
  return todo.length;
}
