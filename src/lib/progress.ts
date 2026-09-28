/**
 * Completion maths for sets and Pokémon. Pure, so it's tested directly.
 *
 *  - Base: every card, any printing. 150 of 165 = 91%.
 *  - Master: every printing of every card TCGplayer lists (reverse holos,
 *    1st Editions...). A card counts once per printing owned.
 */

export interface ProgressCard {
  id: string;
  finishes: string[];
  /** Price of each printing, for the cost to finish. */
  prices: Record<string, number | null>;
}

export interface Progress {
  have: number;
  total: number;
  pct: number;
  /** Cheapest way to buy everything still missing, in dollars. */
  costToComplete: number;
  /** Missing entries with no price, so the cost is a floor. */
  unpricedMissing: number;
}

export function progress(
  cards: ProgressCard[],
  owned: Map<string, Map<string, number>>,
  master: boolean,
): Progress {
  let have = 0;
  let total = 0;
  let cost = 0;
  let unpriced = 0;
  for (const c of cards) {
    const mine = owned.get(c.id);
    if (master) {
      for (const f of c.finishes) {
        total++;
        if ((mine?.get(f) ?? 0) > 0) have++;
        else if (c.prices[f] != null) cost += c.prices[f]!;
        else unpriced++;
      }
    } else {
      total++;
      if (mine && [...mine.values()].some((n) => n > 0)) have++;
      else {
        const cheapest = c.finishes.map((f) => c.prices[f]).filter((p): p is number => p != null);
        if (cheapest.length) cost += Math.min(...cheapest);
        else unpriced++;
      }
    }
  }
  return { have, total, pct: total ? have / total : 0, costToComplete: cost, unpricedMissing: unpriced };
}
