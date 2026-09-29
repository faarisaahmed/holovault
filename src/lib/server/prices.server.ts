import { and, gte, inArray } from "drizzle-orm";
import { finishPrices } from "./catalog.server";
import { getUserDb } from "./db.server";
import { cardPrice, collectionItem, wishlistItem } from "./schema";
import type { OwnedItem } from "./collection.server";

/**
 * Card price history. There's no free source for past card prices, so each
 * daily refresh records today's market price for every card printing that
 * anyone owns or wants. That's what "this week's movers" compares against.
 */

const today = () => new Date().toISOString().slice(0, 10);
const daysAgo = (n: number) => new Date(Date.now() - n * 86_400_000).toISOString().slice(0, 10);

/** Records today's prices for every owned or wanted card. Returns rows written. */
export async function recordCardPrices(): Promise<number> {
  const db = await getUserDb();
  const owned = await db.selectDistinct({ cardId: collectionItem.cardId }).from(collectionItem);
  const wanted = await db.selectDistinct({ cardId: wishlistItem.cardId }).from(wishlistItem);
  const ids = [...new Set([...owned, ...wanted].map((r) => r.cardId))];
  const prices = finishPrices(ids);
  const day = today();
  const rows: { cardId: string; finish: string; day: string; market: string }[] = [];
  for (const [cardId, byFinish] of prices) {
    for (const [finish, market] of byFinish) if (market != null) rows.push({ cardId, finish, day, market: market.toFixed(2) });
  }
  for (let i = 0; i < rows.length; i += 500) await db.insert(cardPrice).values(rows.slice(i, i + 500)).onConflictDoNothing();
  return rows.length;
}

export interface Mover {
  item: OwnedItem;
  then: number;
  now: number;
  /** Fractional change, e.g. 0.18 for +18%. */
  change: number;
  /** Dollar change across every copy held. */
  delta: number;
}

export interface Movers {
  /** Days of history the comparison spans (up to 7). */
  days: number;
  up: Mover[];
  down: Mover[];
  /** Change in the whole collection's market value over those days. */
  total: number;
}

/**
 * How the user's raw cards moved over the last week (or as far back as
 * history goes). Slabs and hand-valued copies are left out: their value
 * doesn't follow the market price.
 */
export async function moversFor(items: OwnedItem[]): Promise<Movers | null> {
  const raw = items.filter((i) => !i.grader && i.valueSource === "market");
  if (!raw.length) return null;
  const db = await getUserDb();
  const ids = [...new Set(raw.map((i) => i.cardId))];
  const history = new Map<string, { day: string; market: number }[]>();
  for (let i = 0; i < ids.length; i += 500) {
    const rows = await db
      .select()
      .from(cardPrice)
      .where(and(inArray(cardPrice.cardId, ids.slice(i, i + 500)), gte(cardPrice.day, daysAgo(8))));
    for (const r of rows) {
      const key = `${r.cardId}|${r.finish}`;
      history.set(key, [...(history.get(key) ?? []), { day: String(r.day), market: Number(r.market) }]);
    }
  }
  let days = 0;
  const moves: Mover[] = [];
  for (const item of raw) {
    const h = history.get(`${item.cardId}|${item.finish}`)?.sort((a, b) => a.day.localeCompare(b.day));
    if (!h || h.length < 2 || item.unitValue == null) continue;
    // Oldest point within the week; today is the live price.
    const first = h[0];
    const span = Math.round((Date.parse(today()) - Date.parse(first.day)) / 86_400_000);
    if (span < 1 || first.market <= 0) continue;
    days = Math.max(days, span);
    const factor = item.marketNm ? item.unitValue / item.marketNm : 1;
    const then = first.market * factor;
    const now = item.unitValue;
    moves.push({ item, then, now, change: now / then - 1, delta: (now - then) * item.quantity });
  }
  if (!moves.length) return { days: 0, up: [], down: [], total: 0 };
  // Ignore rounding noise: a move has to be at least 3% and 50 cents.
  const real = moves.filter((m) => Math.abs(m.change) >= 0.03 && Math.abs(m.now - m.then) >= 0.5);
  return {
    days,
    up: real.filter((m) => m.delta > 0).sort((a, b) => b.delta - a.delta).slice(0, 5),
    down: real.filter((m) => m.delta < 0).sort((a, b) => a.delta - b.delta).slice(0, 5),
    total: moves.reduce((s, m) => s + m.delta, 0),
  };
}
