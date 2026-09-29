/**
 * Sealed inventory maths: holdings and profit from purchase lots and sales,
 * and buy/sell signals from a product's own price history. Pure, so it's
 * tested directly. Signals are plain rules over recorded prices, shown with
 * their reasoning; they are not predictions.
 */

/** Display names for sealed categories (shared by server and browser). */
export const CATEGORY_LABELS: Record<string, string> = {
  box: "Booster box",
  etb: "Elite Trainer Box",
  bundle: "Booster bundle",
  pack: "Pack",
  blister: "Blister",
  tin: "Tin",
  collection: "Collection",
  upc: "Ultra-Premium",
  case: "Case",
  display: "Display",
  deck: "Deck",
  kit: "Kit",
};

export interface Lot {
  quantity: number;
  unitCostCents: number;
}

export interface Sale {
  quantity: number;
  unitPriceCents: number;
  feesCents: number;
}

export interface Holding {
  /** Units still held (bought minus sold). */
  held: number;
  bought: number;
  sold: number;
  /** Average cost per unit across every purchase, in dollars. */
  avgCost: number | null;
  /** What the held units cost, at average cost. */
  costBasis: number;
  /** Proceeds after fees, minus the average cost of the units sold. */
  realized: number;
  proceeds: number;
}

export function holding(lots: Lot[], sales: Sale[]): Holding {
  const bought = lots.reduce((n, l) => n + l.quantity, 0);
  const spent = lots.reduce((n, l) => n + l.quantity * l.unitCostCents, 0) / 100;
  const sold = sales.reduce((n, s) => n + s.quantity, 0);
  const proceeds = sales.reduce((n, s) => n + s.quantity * s.unitPriceCents - s.feesCents, 0) / 100;
  const avgCost = bought ? spent / bought : null;
  const held = Math.max(0, bought - sold);
  return {
    held,
    bought,
    sold,
    avgCost,
    costBasis: avgCost != null ? avgCost * held : 0,
    realized: avgCost != null ? proceeds - avgCost * sold : proceeds,
    proceeds,
  };
}

export interface PricePoint {
  /** ISO date, YYYY-MM-DD. */
  day: string;
  market: number;
}

export interface Trend {
  days: number;
  current: number;
  change7: number | null;
  change30: number | null;
  low90: number;
  high90: number;
  /** Where today sits in the 90-day range: 0 = the low, 1 = the high. */
  position90: number | null;
  avg30: number;
}

const DAY = 86_400_000;
const ts = (d: string) => Date.parse(`${d}T00:00:00Z`);

/** Price at or just before `daysAgo` days before the last point. */
function priceAgo(points: PricePoint[], daysAgo: number): number | null {
  const target = ts(points[points.length - 1].day) - daysAgo * DAY;
  let best: PricePoint | null = null;
  for (const p of points) if (ts(p.day) <= target) best = p;
  return best?.market ?? null;
}

export function trend(points: PricePoint[]): Trend | null {
  const pts = points.filter((p) => Number.isFinite(p.market) && p.market > 0).sort((a, b) => a.day.localeCompare(b.day));
  if (!pts.length) return null;
  const last = pts[pts.length - 1];
  const since = (d: number) => pts.filter((p) => ts(p.day) >= ts(last.day) - d * DAY);
  const w90 = since(90).map((p) => p.market);
  const w30 = since(30).map((p) => p.market);
  const low90 = Math.min(...w90);
  const high90 = Math.max(...w90);
  const pct = (then: number | null) => (then ? (last.market - then) / then : null);
  return {
    days: Math.round((ts(last.day) - ts(pts[0].day)) / DAY),
    current: last.market,
    change7: pct(priceAgo(pts, 7)),
    change30: pct(priceAgo(pts, 30)),
    low90,
    high90,
    position90: high90 > low90 ? (last.market - low90) / (high90 - low90) : null,
    avg30: w30.reduce((a, b) => a + b, 0) / w30.length,
  };
}

export type SignalKind = "buy" | "sell" | "wait" | "hold" | "collecting";

export interface Signal {
  kind: SignalKind;
  title: string;
  why: string;
}

/** The fewest days of history before any call is made. */
export const MIN_HISTORY_DAYS = 14;

const pctText = (x: number) => `${Math.round(x * 100)}%`;

/**
 * A plain-rules read of a product's recent prices. `avgCost` (dollars) is
 * given for products the user holds, so sell calls account for what they paid.
 */
export function signal(t: Trend | null, avgCost: number | null, holdingAny: boolean): Signal {
  if (!t || t.days < MIN_HISTORY_DAYS) {
    return {
      kind: "collecting",
      title: "Collecting price history",
      why: `Signals start after ${MIN_HISTORY_DAYS} days of recorded prices${t ? ` (${t.days} so far)` : ""}.`,
    };
  }
  const pos = t.position90;
  const gain = avgCost ? (t.current - avgCost) / avgCost : null;

  if (holdingAny && pos != null && pos >= 0.85 && (gain == null || gain >= 0.15)) {
    return {
      kind: "sell",
      title: "Good time to sell",
      why: `Near its 90-day high${gain != null ? ` and ${pctText(gain)} above what you paid` : ""}.`,
    };
  }
  if (holdingAny && gain != null && gain >= 0.5) {
    return {
      kind: "sell",
      title: "Worth considering a sale",
      why: `${pctText(gain)} above what you paid, though not at its recent high.`,
    };
  }
  if (pos != null && pos <= 0.2) {
    if (t.change7 != null && t.change7 < -0.05) {
      return {
        kind: "wait",
        title: "Near its low, still falling",
        why: `Down ${pctText(-t.change7)} this week; it may not have bottomed yet.`,
      };
    }
    return {
      kind: "buy",
      title: "Good time to buy",
      why: "Near its 90-day low and holding steady this week.",
    };
  }
  return {
    kind: "hold",
    title: "No strong signal",
    why: pos != null ? `Sitting ${pctText(pos)} of the way up its 90-day range.` : "Its price has barely moved.",
  };
}
