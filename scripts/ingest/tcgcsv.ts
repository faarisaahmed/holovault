import { getJson } from "./http";
import type { SealedKind } from "../../src/lib/types";

const BASE = "https://tcgcsv.com/tcgplayer";
export const CATEGORY = { en: 3, ja: 85 } as const;

export interface CsvGroup {
  groupId: number;
  name: string;
  abbreviation: string | null;
  publishedOn: string;
  categoryId: number;
}

export interface CsvProduct {
  productId: number;
  name: string;
  cleanName: string;
  imageUrl: string | null;
  groupId: number;
  url: string | null;
  extendedData?: { name: string; value: string }[];
}

export interface CsvPrice {
  productId: number;
  lowPrice: number | null;
  midPrice: number | null;
  highPrice: number | null;
  marketPrice: number | null;
  directLowPrice: number | null;
  subTypeName: string;
}

export async function listGroups(category: number) {
  const res = await getJson<{ results: CsvGroup[] }>(`${BASE}/${category}/groups`);
  return res.results;
}

export async function listProducts(category: number, groupId: number) {
  const res = await getJson<{ results: CsvProduct[] }>(`${BASE}/${category}/${groupId}/products`);
  return res.results;
}

export async function listPrices(category: number, groupId: number) {
  const res = await getJson<{ results: CsvPrice[] }>(`${BASE}/${category}/${groupId}/prices`);
  return res.results;
}

export function extended(p: CsvProduct): Record<string, string> {
  const out: Record<string, string> = {};
  for (const e of p.extendedData ?? []) out[e.name] = e.value;
  return out;
}

/** A product is a single card if TCGplayer gave it a collector number. */
export function isSingle(p: CsvProduct): boolean {
  return "Number" in extended(p);
}

/** "122/191" -> "122"; "GG01/GG70" -> "GG01"; "SV045" -> "SV045". */
export function cardNumberOf(p: CsvProduct): string | null {
  const raw = extended(p).Number;
  if (!raw) return null;
  return raw.split("/")[0].trim();
}

/**
 * Sealed product classification. Deliberately conservative: anything we cannot
 * confidently bucket (cases, blisters, code cards, promo tins) is dropped
 * rather than guessed at, so the set-level "box price" column stays honest.
 */
const SEALED_RULES: { kind: SealedKind; test: RegExp }[] = [
  { kind: "box", test: /\bbooster box\b/i },
  { kind: "etb", test: /\belite trainer box\b/i },
  { kind: "bundle", test: /\bbooster bundle\b/i },
  { kind: "bundle", test: /\bbooster pack (art )?bundle\b/i },
  { kind: "pack", test: /\b(sleeved )?booster pack\b/i },
  { kind: "collection", test: /\b(premium collection|special collection|collection box|ex box|v box|vmax box|tin)\b/i },
];

const SEALED_REJECT =
  /\bcase\b|\bcode card\b|\bblister\b|\bdisplay\b|\bcarton\b|\bcheck ?lane\b|\bbuild ?& ?battle\b|\bpokemon center\b|\bset of \d+\b|\bhalf booster box\b|\bmini booster pack\b|\bsurprise box\b/i;

/**
 * Every sealed product gets a category for the sealed inventory, including
 * the cases, displays and blisters that classifySealed deliberately skips.
 * Order matters: "Booster Box Case" is a case, "Elite Trainer Box" an ETB.
 */
const CATEGORY_RULES: [string, RegExp][] = [
  ["case", /\bcases?\b/i],
  ["display", /\bdisplays?\b|\bcartons?\b/i],
  ["upc", /\bultra[- ]premium collections?\b|\bupc\b/i],
  ["etb", /\belite trainer box(es)?\b/i],
  ["box", /\bbooster box(es)?\b|\benhanced booster\b/i],
  ["bundle", /\bbooster bundles?\b|\bbooster pack art bundles?\b/i],
  ["kit", /\bbuild ?& ?battle\b|\bprerelease\b|\bkit\b/i],
  ["blister", /\bblisters?\b|\bcheck ?lanes?\b|\b\d[- ]pack\b/i],
  ["tin", /\btins?\b/i],
  ["deck", /\bdecks?\b|\bbattle academy\b/i],
  ["pack", /\bbooster packs?\b|\bmini booster\b|\bboosters?\b|\bposter packs?\b|\bfun packs?\b/i],
  ["collection", /\bcollections?\b|\bbox(es)?\b|\bpremium\b|\bset of \d+\b|\bbinders?\b|\bchests?\b|\bbundles?\b/i],
];

/**
 * The sealed-inventory category for a product, or null when it isn't sealed
 * product: code cards, and single cards TCGplayer lists without a number
 * (they still carry a rarity), are left out.
 */
export function sealedCategory(p: Pick<CsvProduct, "name" | "extendedData">): string | null {
  if (/\bcode card\b/i.test(p.name)) return null;
  if (extended(p as CsvProduct).Rarity) return null;
  for (const [cat, re] of CATEGORY_RULES) if (re.test(p.name)) return cat;
  return null;
}

/** Packs contained in each sealed product kind. Japanese boxes hold 30. */
const PACK_COUNTS: Record<"en" | "ja", Partial<Record<SealedKind, number>>> = {
  en: { box: 36, etb: 9, bundle: 6, pack: 1 },
  ja: { box: 30, etb: 10, bundle: 6, pack: 1 },
};

export function classifySealed(
  region: "en" | "ja",
  name: string,
): { kind: SealedKind; packCount: number | null } | null {
  if (SEALED_REJECT.test(name)) return null;
  for (const rule of SEALED_RULES) {
    if (rule.test.test(name)) {
      return { kind: rule.kind, packCount: PACK_COUNTS[region][rule.kind] ?? null };
    }
  }
  return null;
}
