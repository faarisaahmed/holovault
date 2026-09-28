import { and, eq } from "drizzle-orm";
import { progress, type Progress, type ProgressCard } from "@/lib/progress";
import { cardsInSet, finishPrices, finishesFor, listSets, type CatalogCard, type SetSummary } from "./catalog.server";
import { ownedCounts } from "./collection.server";
import { getUserDb } from "./db.server";
import { goal } from "./schema";

export function progressCards(cards: CatalogCard[]): ProgressCard[] {
  const prices = finishPrices(cards.map((c) => c.id));
  return cards.map((c) => {
    const p = prices.get(c.id);
    const finishes = finishesFor(c, p);
    return {
      id: c.id,
      finishes,
      prices: Object.fromEntries(finishes.map((f) => [f, p?.get(f) ?? (finishes.length === 1 ? c.marketPrice : null)])),
    };
  });
}

export interface SetProgressRow {
  set: SetSummary;
  base: Progress;
  master: Progress;
  tracked: boolean;
}

/** Every set the user owns a card from or is tracking, with base and master progress. */
export async function mySets(userId: string): Promise<SetProgressRow[]> {
  const owned = await ownedCounts(userId);
  const db = await getUserDb();
  const goals = await db.select().from(goal).where(and(eq(goal.userId, userId), eq(goal.kind, "set")));
  const tracked = new Set(goals.map((g) => g.target));
  const ownedSets = new Set<string>();
  // Card ids are "<set id>-<number>"; the set is everything before the last dash.
  for (const id of owned.keys()) ownedSets.add(id.slice(0, id.lastIndexOf("-")));
  const sets = listSets().filter((s) => ownedSets.has(s.id) || tracked.has(s.id));
  return sets.map((set) => {
    const cards = progressCards(cardsInSet(set.id));
    return {
      set,
      base: progress(cards, owned, false),
      master: progress(cards, owned, true),
      tracked: tracked.has(set.id),
    };
  });
}

export async function setGoal(userId: string, kind: "set" | "species", target: string, on: boolean) {
  const db = await getUserDb();
  await db.delete(goal).where(and(eq(goal.userId, userId), eq(goal.kind, kind), eq(goal.target, target)));
  if (on) await db.insert(goal).values({ userId, kind, target });
}

export async function trackedSpecies(userId: string): Promise<number[]> {
  const db = await getUserDb();
  const rows = await db.select().from(goal).where(and(eq(goal.userId, userId), eq(goal.kind, "species")));
  return rows.map((r) => Number(r.target)).filter(Number.isFinite);
}
