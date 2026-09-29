import { and, eq, gte, inArray } from "drizzle-orm";
import { z } from "zod";
import { cents } from "@/lib/valuation";
import { cardsByIds, finishPrices, finishesFor, getCard, type CatalogCard } from "./catalog.server";
import { getUserDb } from "./db.server";
import { cardPrice, collectionItem, wishlistItem } from "./schema";

/** Cards a user is hunting, priced today and against when they added them. */

export const wishInput = z.object({
  cardId: z.string().min(1).max(64),
  finish: z.string().max(40).optional().nullable(),
  target: z
    .string()
    .transform((v) => v.replace(/[$,\s]/g, ""))
    .pipe(z.string().regex(/^\d{0,7}(\.\d{1,2})?$/, "Enter an amount like 12.50"))
    .optional()
    .nullable(),
  note: z.string().max(300).optional().nullable(),
});

/** The price that matters for a wish: its printing, or the cheapest when any will do. */
function priceFor(card: CatalogCard, finish: string | null, prices: Map<string, number | null> | undefined): number | null {
  if (finish) return prices?.get(finish) ?? (finish === "Normal" || finish === "Holofoil" ? card.marketPrice : null);
  const all = [...(prices?.values() ?? [])].filter((p): p is number => p != null);
  return all.length ? Math.min(...all) : card.marketPrice;
}

export async function addWish(userId: string, raw: unknown): Promise<{ error: string } | { ok: true; name: string }> {
  const parsed = wishInput.safeParse(raw);
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Check the form." };
  const card = getCard(parsed.data.cardId);
  if (!card) return { error: "That card isn't in the catalog." };
  const finish = parsed.data.finish || null;
  const prices = finishPrices([card.id]).get(card.id);
  if (finish && !finishesFor(card, prices).includes(finish)) return { error: `${card.name} isn't printed as ${finish}.` };
  const db = await getUserDb();
  const existing = await db
    .select({ id: wishlistItem.id, finish: wishlistItem.finish })
    .from(wishlistItem)
    .where(and(eq(wishlistItem.userId, userId), eq(wishlistItem.cardId, card.id)));
  if (existing.some((e) => (e.finish ?? null) === finish)) return { ok: true, name: card.name };
  const now = priceFor(card, finish, prices);
  await db.insert(wishlistItem).values({
    userId,
    cardId: card.id,
    finish,
    targetCents: parsed.data.target ? cents(Number(parsed.data.target)) : null,
    priceAtAddCents: cents(now),
    note: parsed.data.note?.trim() || null,
  });
  return { ok: true, name: card.name };
}

export async function removeWish(userId: string, id: string) {
  const db = await getUserDb();
  await db.delete(wishlistItem).where(and(eq(wishlistItem.id, id), eq(wishlistItem.userId, userId)));
}

export async function setWishTarget(userId: string, id: string, target: string | null) {
  const t = target?.replace(/[$,\s]/g, "") ?? "";
  if (t && !/^\d{0,7}(\.\d{1,2})?$/.test(t)) return { error: "Enter an amount like 12.50" };
  const db = await getUserDb();
  await db
    .update(wishlistItem)
    .set({ targetCents: t ? cents(Number(t)) : null })
    .where(and(eq(wishlistItem.id, id), eq(wishlistItem.userId, userId)));
  return { ok: true };
}

export interface Wish {
  id: string;
  card: CatalogCard;
  finish: string | null;
  price: number | null;
  priceAtAdd: number | null;
  target: number | null;
  /** Lowest recorded price over the last week, for "dropped" flags. */
  weekHigh: number | null;
  owned: number;
  note: string | null;
  createdAt: string;
  /** Why it deserves a look: under target, or down a fair bit. */
  flag: "target" | "drop" | null;
}

export async function wishlist(userId: string): Promise<Wish[]> {
  const db = await getUserDb();
  const rows = await db.select().from(wishlistItem).where(eq(wishlistItem.userId, userId));
  if (!rows.length) return [];
  const ids = [...new Set(rows.map((r) => r.cardId))];
  const cards = cardsByIds(ids);
  const prices = finishPrices(ids);
  const ownedRows = await db
    .select({ cardId: collectionItem.cardId, finish: collectionItem.finish, quantity: collectionItem.quantity })
    .from(collectionItem)
    .where(and(eq(collectionItem.userId, userId), inArray(collectionItem.cardId, ids)));
  const week = await db
    .select()
    .from(cardPrice)
    .where(and(inArray(cardPrice.cardId, ids), gte(cardPrice.day, new Date(Date.now() - 8 * 86_400_000).toISOString().slice(0, 10))));
  const out: Wish[] = [];
  for (const r of rows) {
    const card = cards.get(r.cardId);
    if (!card) continue;
    const price = priceFor(card, r.finish, prices.get(r.cardId));
    const hist = week.filter((w) => w.cardId === r.cardId && (!r.finish || w.finish === r.finish)).map((w) => Number(w.market));
    const weekHigh = hist.length ? Math.max(...hist) : null;
    const target = r.targetCents != null ? r.targetCents / 100 : null;
    const priceAtAdd = r.priceAtAddCents != null ? r.priceAtAddCents / 100 : null;
    const ref = Math.max(weekHigh ?? 0, priceAtAdd ?? 0);
    const flag = price != null && target != null && price <= target ? "target" : price != null && ref > 0 && price <= ref * 0.9 ? "drop" : null;
    out.push({
      id: r.id,
      card,
      finish: r.finish,
      price,
      priceAtAdd,
      target,
      weekHigh,
      owned: ownedRows.filter((o) => o.cardId === r.cardId && (!r.finish || o.finish === r.finish)).reduce((n, o) => n + o.quantity, 0),
      note: r.note,
      createdAt: r.createdAt.toISOString(),
      flag,
    });
  }
  return out;
}

/** cardId → wished printings ("" for any), for "♥ wanted" badges. */
export async function wishedCards(userId: string, cardIds: string[]): Promise<Map<string, Set<string>>> {
  const out = new Map<string, Set<string>>();
  if (!cardIds.length) return out;
  const db = await getUserDb();
  const rows = await db
    .select({ cardId: wishlistItem.cardId, finish: wishlistItem.finish })
    .from(wishlistItem)
    .where(and(eq(wishlistItem.userId, userId), inArray(wishlistItem.cardId, cardIds.slice(0, 1000))));
  for (const r of rows) out.set(r.cardId, (out.get(r.cardId) ?? new Set()).add(r.finish ?? ""));
  return out;
}
