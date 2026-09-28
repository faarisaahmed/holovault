import { z } from "zod";

/**
 * Binder planning: which cards go in a binder and in what order, laid out
 * on pages of rows x cols pockets. Pure, so it's tested directly and shared
 * by the page and its loader.
 */

export const binderConfig = z.object({
  /** Where the cards come from. */
  source: z.enum(["collection", "pokedex", "set", "pokemon"]).default("collection"),
  region: z.enum(["en", "ja"]).default("en"),
  setId: z.string().max(40).optional(),
  dexId: z.coerce.number().int().min(1).max(2000).optional(),
  /** Leave out hits (Double Rare and up), keeping commons through holos. */
  excludeRares: z.boolean().default(false),
  /** Just one card per Pokédex number (the owned one, if any). */
  onePerPokemon: z.boolean().default(false),
  /** Leave out Trainer and Energy cards. */
  pokemonOnly: z.boolean().default(false),
  sort: z.enum(["dex", "set", "release", "name", "value", "rarity"]).default("dex"),
  /** Start a new page at each set (or Pokémon generation for "dex"). */
  breakPages: z.boolean().default(false),
});

export type BinderConfig = z.infer<typeof binderConfig>;

export const LAYOUTS = [
  { rows: 2, cols: 2, label: "2×2 (4-pocket)" },
  { rows: 3, cols: 3, label: "3×3 (9-pocket)" },
  { rows: 3, cols: 4, label: "3×4 (12-pocket)" },
  { rows: 4, cols: 4, label: "4×4 (16-pocket)" },
] as const;

export interface BinderCandidate {
  id: string;
  name: string;
  image: string | null;
  setId: string;
  setName: string;
  releaseDate: string | null;
  numberSort: number;
  localId: string;
  dexIds: number[];
  rarityRank: number;
  price: number | null;
  owned: boolean;
}

export interface Slot {
  key: string;
  card: BinderCandidate | null;
  /** For an empty Pokédex pocket: which Pokémon belongs here. */
  label?: string;
  owned: boolean;
}

const GENERATION_STARTS = [1, 152, 252, 387, 494, 650, 722, 810, 906];

function generationOf(dex: number): number {
  let g = 0;
  for (const start of GENERATION_STARTS) if (dex >= start) g++;
  return g;
}

/**
 * Orders the candidates into pockets. With onePerPokemon, each Pokédex number
 * gets one pocket — an owned card if there is one, else the cheapest
 * matching card as the one to look for — and numbers with no cards at all
 * become labelled empty pockets, so the binder keeps its order.
 */
export function planSlots(
  candidates: BinderCandidate[],
  cfg: BinderConfig,
  species?: { dexId: number; name: string }[],
): Slot[] {
  let cards = candidates;
  if (cfg.excludeRares) cards = cards.filter((c) => c.rarityRank < 50);
  if (cfg.pokemonOnly || cfg.source === "pokedex") cards = cards.filter((c) => c.dexIds.length > 0);

  if (cfg.onePerPokemon || cfg.source === "pokedex") {
    const byDex = new Map<number, BinderCandidate[]>();
    for (const c of cards) {
      const d = c.dexIds[0];
      if (d == null) continue;
      byDex.set(d, [...(byDex.get(d) ?? []), c]);
    }
    const pick = (list: BinderCandidate[]) =>
      list.find((c) => c.owned) ??
      [...list].sort((a, b) => (a.price ?? Infinity) - (b.price ?? Infinity) || (b.releaseDate ?? "").localeCompare(a.releaseDate ?? ""))[0];
    const numbers = species?.length ? species.map((s) => s.dexId) : [...byDex.keys()].sort((a, b) => a - b);
    const names = new Map(species?.map((s) => [s.dexId, s.name]) ?? []);
    return numbers.map((d) => {
      const list = byDex.get(d);
      const card = list ? pick(list) : null;
      return { key: `dex-${d}`, card, owned: !!card?.owned, label: `#${d} ${names.get(d) ?? ""}`.trim() };
    });
  }

  const sorted = [...cards].sort(comparator(cfg.sort));
  return sorted.map((c) => ({ key: c.id, card: c, owned: c.owned }));
}

function comparator(sort: BinderConfig["sort"]) {
  const bySet = (a: BinderCandidate, b: BinderCandidate) =>
    (a.releaseDate ?? "").localeCompare(b.releaseDate ?? "") || a.setId.localeCompare(b.setId) || a.numberSort - b.numberSort;
  switch (sort) {
    case "dex":
      return (a: BinderCandidate, b: BinderCandidate) =>
        (a.dexIds[0] ?? 9999) - (b.dexIds[0] ?? 9999) || bySet(a, b);
    case "name":
      return (a: BinderCandidate, b: BinderCandidate) => a.name.localeCompare(b.name) || bySet(a, b);
    case "value":
      return (a: BinderCandidate, b: BinderCandidate) => (b.price ?? -1) - (a.price ?? -1);
    case "rarity":
      return (a: BinderCandidate, b: BinderCandidate) => a.rarityRank - b.rarityRank || bySet(a, b);
    case "release":
    case "set":
    default:
      return bySet;
  }
}

/**
 * Splits pockets into pages. With breakPages, a new set (or Pokémon
 * generation, in Pokédex order) always starts on a fresh page.
 */
export function paginate(slots: Slot[], perPage: number, cfg: Pick<BinderConfig, "breakPages" | "sort" | "source">): Slot[][] {
  const pages: Slot[][] = [];
  let page: Slot[] = [];
  let lastGroup: string | null = null;
  const groupOf = (s: Slot) => {
    if (cfg.sort === "dex" || cfg.source === "pokedex") {
      const d = s.card?.dexIds[0] ?? Number(s.key.replace("dex-", ""));
      return Number.isFinite(d) ? `gen${generationOf(d)}` : null;
    }
    return s.card?.setId ?? null;
  };
  for (const s of slots) {
    const g = groupOf(s);
    if (cfg.breakPages && page.length && lastGroup != null && g !== lastGroup) {
      pages.push(page);
      page = [];
    }
    page.push(s);
    lastGroup = g;
    if (page.length === perPage) {
      pages.push(page);
      page = [];
    }
  }
  if (page.length) pages.push(page);
  return pages;
}
