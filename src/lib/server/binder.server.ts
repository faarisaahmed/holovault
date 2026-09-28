import { and, desc, eq } from "drizzle-orm";
import { z } from "zod";
import { LAYOUTS, binderConfig, type BinderCandidate, type BinderConfig } from "@/lib/binder";
import { allPokemonCards, cardsInSet, cardsOfSpecies, listSpecies, type CatalogCard } from "./catalog.server";
import { ownedCounts, valuedCollection } from "./collection.server";
import { getUserDb } from "./db.server";
import { binder } from "./schema";

export const binderInput = z.object({
  name: z.string().trim().min(1).max(60),
  layout: z.enum(LAYOUTS.map((l) => `${l.rows}x${l.cols}`) as [string, ...string[]]),
  source: binderConfig.shape.source,
  region: binderConfig.shape.region,
  setId: z.string().max(40).optional(),
  dexId: z.coerce.number().int().min(1).max(2000).optional(),
  excludeRares: z.literal("on").optional(),
  onePerPokemon: z.literal("on").optional(),
  pokemonOnly: z.literal("on").optional(),
  breakPages: z.literal("on").optional(),
  sort: binderConfig.shape.sort,
});

export function toRecord(input: z.infer<typeof binderInput>) {
  const [rows, cols] = input.layout.split("x").map(Number);
  const config: BinderConfig = binderConfig.parse({
    source: input.source,
    region: input.region,
    setId: input.source === "set" ? input.setId : undefined,
    dexId: input.source === "pokemon" ? input.dexId : undefined,
    excludeRares: !!input.excludeRares,
    onePerPokemon: !!input.onePerPokemon,
    pokemonOnly: !!input.pokemonOnly,
    breakPages: !!input.breakPages,
    sort: input.sort,
  });
  return { name: input.name, rows, cols, config };
}

export async function listBinders(userId: string) {
  const db = await getUserDb();
  const rows = await db.select().from(binder).where(eq(binder.userId, userId)).orderBy(desc(binder.updatedAt));
  return rows.map((r) => ({ ...r, config: binderConfig.parse(r.config ?? {}) }));
}

export async function getBinder(userId: string, id: string) {
  if (!z.uuid().safeParse(id).success) return null;
  const db = await getUserDb();
  const [row] = await db.select().from(binder).where(and(eq(binder.id, id), eq(binder.userId, userId)));
  return row ? { ...row, config: binderConfig.parse(row.config ?? {}) } : null;
}

export async function createBinder(userId: string, rec: ReturnType<typeof toRecord>) {
  const db = await getUserDb();
  const [row] = await db.insert(binder).values({ userId, ...rec }).returning({ id: binder.id });
  return row.id;
}

export async function updateBinder(userId: string, id: string, rec: ReturnType<typeof toRecord>) {
  const db = await getUserDb();
  await db
    .update(binder)
    .set({ ...rec, updatedAt: new Date() })
    .where(and(eq(binder.id, id), eq(binder.userId, userId)));
}

export async function deleteBinder(userId: string, id: string) {
  const db = await getUserDb();
  await db.delete(binder).where(and(eq(binder.id, id), eq(binder.userId, userId)));
}

function candidate(c: CatalogCard, owned: boolean, price = c.marketPrice): BinderCandidate {
  return {
    id: c.id,
    name: c.name,
    image: c.image,
    setId: c.setId,
    setName: c.setName,
    releaseDate: c.releaseDate,
    numberSort: c.numberSort,
    localId: c.localId,
    dexIds: c.dexIds,
    rarityRank: c.rarityRank,
    price,
    owned,
  };
}

/** The cards a binder draws from, flagged owned or not. */
export async function binderCandidates(userId: string, cfg: BinderConfig) {
  if (cfg.source === "collection") {
    const items = await valuedCollection(userId);
    const seen = new Map<string, BinderCandidate>();
    for (const i of items) {
      if (!i.card || i.card.region !== cfg.region) continue;
      const prev = seen.get(i.cardId);
      // One pocket per card; its value is the best copy's.
      if (!prev || (i.unitValue ?? 0) > (prev.price ?? 0)) seen.set(i.cardId, candidate(i.card, true, i.unitValue));
    }
    return { cards: [...seen.values()], species: undefined };
  }
  const owned = await ownedCounts(userId);
  const flag = (cards: CatalogCard[]) => cards.map((c) => candidate(c, owned.has(c.id)));
  if (cfg.source === "set" && cfg.setId) return { cards: flag(cardsInSet(cfg.setId)), species: undefined };
  if (cfg.source === "pokemon" && cfg.dexId) return { cards: flag(cardsOfSpecies(cfg.dexId, cfg.region)), species: undefined };
  if (cfg.source === "pokedex") return { cards: flag(allPokemonCards(cfg.region)), species: listSpecies() };
  return { cards: [], species: undefined };
}
