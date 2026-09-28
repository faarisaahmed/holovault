import { getDb } from "@/lib/db.server";
import { NOT_SUBSET_COPY, isStandaloneSubset } from "@/lib/subsets";
import type { Region } from "@/lib/types";

/**
 * Read-only queries over the card catalog (SQLite, rebuilt each deploy by
 * `npm run ingest`, same pipeline as Ripwise). Standalone subset
 * copies ("<id>@<subset>") are always excluded: a Trainer Gallery card lives
 * in its parent set here.
 */

export interface CatalogCard {
  id: string;
  setId: string;
  setName: string;
  setAbbr: string | null;
  region: Region;
  localId: string;
  numberSort: number;
  name: string;
  rarity: string | null;
  rarityKey: string | null;
  rarityRank: number;
  image: string | null;
  marketPrice: number | null;
  releaseDate: string | null;
  officialCount: number;
  dexIds: number[];
  seriesName: string | null;
}

const CARD_COLUMNS = `c.id, c.set_id, s.name set_name, s.abbreviation set_abbr, c.region, c.local_id,
  c.number_sort, c.name, c.rarity, c.rarity_key, c.rarity_rank, c.image, c.market_price,
  s.release_date, s.card_count_official, c.dex_ids, s.series_name`;

function toCard(r: Record<string, unknown>): CatalogCard {
  return {
    id: r.id as string,
    setId: r.set_id as string,
    setName: r.set_name as string,
    setAbbr: (r.set_abbr as string) ?? null,
    region: r.region as Region,
    localId: r.local_id as string,
    numberSort: r.number_sort as number,
    name: r.name as string,
    rarity: (r.rarity as string) ?? null,
    rarityKey: (r.rarity_key as string) ?? null,
    rarityRank: (r.rarity_rank as number) ?? 0,
    image: (r.image as string) ?? null,
    marketPrice: (r.market_price as number) ?? null,
    releaseDate: (r.release_date as string) ?? null,
    officialCount: (r.card_count_official as number) ?? 0,
    dexIds: r.dex_ids ? (r.dex_ids as string).split(",").filter(Boolean).map(Number) : [],
    seriesName: (r.series_name as string) ?? null,
  };
}

/**
 * Card search tuned for adding cards quickly. Words match the card or set
 * name ("charizard 151"), a number matches the collector number ("charizard
 * 199", "199/165"), and a set code matches exactly ("sv03.5 199", "MEW 199").
 */
export function searchCards(query: string, region: Region, limit = 60): CatalogCard[] {
  const db = getDb();
  const tokens = query.trim().toLowerCase().split(/\s+/).filter(Boolean).slice(0, 6);
  if (!tokens.length) return [];

  const where: string[] = [`c.region = @region`, NOT_SUBSET_COPY.replace("id", "c.id")];
  const params: Record<string, unknown> = { region, limit };
  tokens.forEach((t, i) => {
    const num = t.match(/^#?0*(\d+)(?:\/\d+)?$/);
    if (num) {
      where.push(`(c.number_sort = @n${i} OR lower(c.local_id) = @t${i})`);
      params[`n${i}`] = Number(num[1]);
      params[`t${i}`] = t.replace(/^#/, "").split("/")[0];
      return;
    }
    where.push(
      `(lower(c.name) LIKE @l${i} OR lower(s.name) LIKE @l${i} OR lower(s.id) = @t${i}
        OR lower(coalesce(s.abbreviation, '')) = @t${i} OR lower(c.local_id) = @t${i})`,
    );
    params[`l${i}`] = `%${t}%`;
    params[`t${i}`] = t;
  });

  const rows = db
    .prepare(
      `SELECT ${CARD_COLUMNS} FROM cards c JOIN sets s ON s.id = c.set_id
       WHERE ${where.join(" AND ")}
       ORDER BY (lower(c.name) = @whole) DESC, s.release_date DESC, c.number_sort ASC
       LIMIT @limit`,
    )
    .all({ ...params, whole: query.trim().toLowerCase() }) as Record<string, unknown>[];
  return rows.map(toCard);
}

export function cardsByIds(ids: string[]): Map<string, CatalogCard> {
  const out = new Map<string, CatalogCard>();
  const db = getDb();
  // SQLite caps bound parameters; chunk large collections.
  for (let i = 0; i < ids.length; i += 500) {
    const chunk = ids.slice(i, i + 500);
    const rows = db
      .prepare(
        `SELECT ${CARD_COLUMNS} FROM cards c JOIN sets s ON s.id = c.set_id
         WHERE c.id IN (${chunk.map(() => "?").join(",")})`,
      )
      .all(...chunk) as Record<string, unknown>[];
    for (const r of rows) out.set(r.id as string, toCard(r));
  }
  return out;
}

export function getCard(id: string): CatalogCard | null {
  return cardsByIds([id]).get(id) ?? null;
}

/** Order printings appear in pickers: plain first, then foils, then 1st Edition. */
export const FINISH_ORDER = [
  "Normal",
  "Holofoil",
  "Reverse Holofoil",
  "Unlimited",
  "Unlimited Holofoil",
  "1st Edition",
  "1st Edition Holofoil",
];

/** cardId -> printing -> market price (null when TCGplayer lists it unpriced). */
export function finishPrices(ids: string[]): Map<string, Map<string, number | null>> {
  const out = new Map<string, Map<string, number | null>>();
  const db = getDb();
  for (let i = 0; i < ids.length; i += 500) {
    const chunk = ids.slice(i, i + 500);
    const rows = db
      .prepare(
        `SELECT card_id, variant, market FROM card_prices
         WHERE card_id IN (${chunk.map(() => "?").join(",")})`,
      )
      .all(...chunk) as { card_id: string; variant: string; market: number | null }[];
    for (const r of rows) {
      const m = out.get(r.card_id) ?? new Map();
      m.set(r.variant, r.market);
      out.set(r.card_id, m);
    }
  }
  return out;
}

/**
 * The printings a card exists in. TCGplayer's listing is the source; a card
 * it doesn't price still exists in at least one printing, guessed from its
 * rarity.
 */
export function finishesFor(card: Pick<CatalogCard, "id" | "rarityKey">, prices?: Map<string, number | null>): string[] {
  const listed = prices ? [...prices.keys()] : [];
  if (listed.length) return FINISH_ORDER.filter((f) => listed.includes(f)).concat(listed.filter((f) => !FINISH_ORDER.includes(f)));
  const plain = ["common", "uncommon", "rare", "unknown"].includes(card.rarityKey ?? "unknown");
  return [plain ? "Normal" : "Holofoil"];
}

export interface SetSummary {
  id: string;
  name: string;
  region: Region;
  releaseDate: string | null;
  logo: string | null;
  symbol: string | null;
  abbreviation: string | null;
  cardCount: number;
  seriesName: string | null;
}

export function listSets(region?: Region): SetSummary[] {
  const rows = getDb()
    .prepare(
      `SELECT id, name, region, release_date, logo, symbol, abbreviation, series_name,
              (SELECT COUNT(*) FROM cards c WHERE c.set_id = s.id AND ${NOT_SUBSET_COPY.replace("id", "c.id")}) n
       FROM sets s
       ${region ? "WHERE region = @region" : ""}
       ORDER BY release_date DESC`,
    )
    .all(region ? { region } : {}) as Record<string, unknown>[];
  // Standalone subset pages (Trainer Galleries etc.) are part of their parent here.
  return rows.filter((r) => !isStandaloneSubset(r.id as string)).map((r) => ({
    id: r.id as string,
    name: r.name as string,
    region: r.region as Region,
    releaseDate: (r.release_date as string) ?? null,
    logo: (r.logo as string) ?? null,
    symbol: (r.symbol as string) ?? null,
    abbreviation: (r.abbreviation as string) ?? null,
    cardCount: r.n as number,
    seriesName: (r.series_name as string) ?? null,
  }));
}

export function getSetSummary(id: string): SetSummary | null {
  return listSets().find((s) => s.id === id) ?? null;
}

export function cardsInSet(setId: string): CatalogCard[] {
  return (
    getDb()
      .prepare(
        `SELECT ${CARD_COLUMNS} FROM cards c JOIN sets s ON s.id = c.set_id
         WHERE c.set_id = ? AND ${NOT_SUBSET_COPY.replace("id", "c.id")}
         ORDER BY c.number_sort, c.local_id`,
      )
      .all(setId) as Record<string, unknown>[]
  ).map(toCard);
}

export function cardsOfSpecies(dexId: number, region: Region): CatalogCard[] {
  return (
    getDb()
      .prepare(
        `SELECT ${CARD_COLUMNS} FROM cards c JOIN sets s ON s.id = c.set_id
         WHERE c.region = ? AND instr(c.dex_ids, ?) > 0 AND ${NOT_SUBSET_COPY.replace("id", "c.id")}
         ORDER BY s.release_date, c.number_sort`,
      )
      .all(region, `,${dexId},`) as Record<string, unknown>[]
  ).map(toCard);
}

/** Every Pokémon card in a language, for Pokédex-order binders. */
export function allPokemonCards(region: Region): CatalogCard[] {
  return (
    getDb()
      .prepare(
        `SELECT ${CARD_COLUMNS} FROM cards c JOIN sets s ON s.id = c.set_id
         WHERE c.region = ? AND c.dex_ids IS NOT NULL AND ${NOT_SUBSET_COPY.replace("id", "c.id")}`,
      )
      .all(region) as Record<string, unknown>[]
  ).map(toCard);
}

export interface Species {
  dexId: number;
  name: string;
}

export function listSpecies(): Species[] {
  return (
    getDb().prepare(`SELECT dex_id, name FROM species ORDER BY dex_id`).all() as { dex_id: number; name: string }[]
  ).map((r) => ({ dexId: r.dex_id, name: r.name }));
}

export function lastIngest(): string | null {
  const r = getDb().prepare("SELECT value FROM meta WHERE key = 'last_ingest'").get() as { value: string } | undefined;
  return r?.value ?? null;
}
