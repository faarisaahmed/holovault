/**
 * How an owned card is valued, and whether it is worth grading. Pure
 * functions so the maths is tested apart from the database.
 */

export const CONDITIONS = [
  { code: "M", label: "Mint", short: "M", factor: 1 },
  { code: "NM", label: "Near Mint", short: "NM", factor: 1 },
  { code: "LP", label: "Lightly Played", short: "LP", factor: 0.85 },
  { code: "MP", label: "Moderately Played", short: "MP", factor: 0.7 },
  { code: "HP", label: "Heavily Played", short: "HP", factor: 0.5 },
  { code: "DMG", label: "Damaged", short: "DMG", factor: 0.35 },
] as const;

export type ConditionCode = (typeof CONDITIONS)[number]["code"];

/**
 * TCGplayer's market price is for Near Mint; played copies sell at a
 * discount. The factors are typical TCGplayer condition discounts, shown to
 * users as an estimate. Mint has no separate market, so it values as NM —
 * its payoff is in grading.
 */
export function conditionFactor(code: string | null | undefined): number {
  return CONDITIONS.find((c) => c.code === code)?.factor ?? 1;
}

export const GRADERS = ["PSA", "BGS", "CGC", "TAG", "SGC", "ACE"] as const;
export const GRADES = [10, 9.5, 9, 8.5, 8, 7, 6, 5, 4, 3, 2, 1] as const;

export interface ValuedItem {
  finish: string;
  condition: string | null;
  grader: string | null;
  grade: string | number | null;
  valueOverrideCents: number | null;
}

export interface ValueInputs {
  /** Market price for this card in this printing, if TCGplayer lists one. */
  finishPrice: number | null | undefined;
  /** The card's headline market price, used when the printing is unpriced. */
  cardPrice: number | null;
  /** PSA sold averages by grade ("10", "9"...), when comps exist. */
  psa?: Map<string, number>;
}

export type ValueSource = "override" | "graded" | "market" | "none";

/** Per-copy value in dollars, and where it came from. */
export function unitValue(item: ValuedItem, v: ValueInputs): { value: number | null; source: ValueSource; estimate: boolean } {
  if (item.valueOverrideCents != null) {
    return { value: item.valueOverrideCents / 100, source: "override", estimate: false };
  }
  if (item.grader) {
    // Only PSA comps are collected; other slabs fall back to raw value.
    const g = item.grade != null ? String(Number(item.grade)) : null;
    const comp = item.grader === "PSA" && g ? v.psa?.get(g) : undefined;
    if (comp != null) return { value: comp, source: "graded", estimate: false };
  }
  const base = v.finishPrice ?? v.cardPrice;
  if (base == null) return { value: null, source: "none", estimate: false };
  const factor = item.grader ? 1 : conditionFactor(item.condition);
  return { value: base * factor, source: "market", estimate: factor !== 1 };
}

export interface GradingInputs {
  rawValue: number;
  psa9?: number;
  psa10?: number;
  /** Grading fee plus shipping and insurance, per card, in dollars. */
  cost: number;
}

export type GradingVerdict = "grade" | "maybe" | "no" | "unknown";

/**
 * A raw Mint / Near Mint card is worth grading when even a PSA 9 sells for
 * more than the raw card plus the cost of grading it. If only a PSA 10 would
 * cover it, it's a maybe (10s are far from guaranteed). Without comps the
 * break-even — what a slab must sell for — is still useful.
 */
export function gradingCall(i: GradingInputs): {
  verdict: GradingVerdict;
  gain9: number | null;
  gain10: number | null;
  breakEven: number;
} {
  const breakEven = i.rawValue + i.cost;
  const gain9 = i.psa9 != null ? i.psa9 - breakEven : null;
  const gain10 = i.psa10 != null ? i.psa10 - breakEven : null;
  let verdict: GradingVerdict = "unknown";
  if (gain9 != null && gain9 > 0) verdict = "grade";
  else if (gain10 != null && gain10 > 0) verdict = "maybe";
  else if (gain9 != null || gain10 != null) verdict = "no";
  return { verdict, gain9, gain10, breakEven };
}

export function cents(dollars: number | null | undefined): number | null {
  return dollars == null || Number.isNaN(dollars) ? null : Math.round(dollars * 100);
}
