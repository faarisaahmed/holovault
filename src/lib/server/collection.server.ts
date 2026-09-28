import { and, desc, eq, isNull, sql } from "drizzle-orm";
import { z } from "zod";
import { CONDITIONS, GRADERS, cents, unitValue, type ValueSource } from "@/lib/valuation";
import { cardsByIds, finishPrices, type CatalogCard } from "./catalog.server";
import { getUserDb } from "./db.server";
import { gradedPrices } from "./graded.server";
import { collectionItem, userSettings } from "./schema";

/**
 * A user's collection. Every function takes the user id from the session
 * (never from the request body) and filters on it, so one account can never
 * read or change another's rows.
 */

const money = z
  .union([z.string(), z.number()])
  .transform((v) => (typeof v === "string" ? v.replace(/[$,\s]/g, "") : String(v)))
  .pipe(z.string().regex(/^\d{0,7}(\.\d{1,2})?$/, "Enter an amount like 12.50"))
  .transform((v) => (v === "" ? null : cents(Number(v))));

export const itemInput = z
  .object({
    cardId: z.string().min(1).max(64),
    finish: z.string().min(1).max(40),
    condition: z.enum(CONDITIONS.map((c) => c.code) as [string, ...string[]]).nullable().optional(),
    grader: z.enum(GRADERS).nullable().optional(),
    grade: z.coerce.number().min(1).max(10).multipleOf(0.5).nullable().optional(),
    certNumber: z.string().max(40).nullable().optional(),
    quantity: z.coerce.number().int().min(1).max(999).default(1),
    purchase: money.nullable().optional(),
    valueOverride: money.nullable().optional(),
    acquiredOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
    notes: z.string().max(500).nullable().optional(),
  })
  .transform((v) => ({
    ...v,
    // A slab has a grade, not a raw condition.
    condition: v.grader ? null : (v.condition ?? "NM"),
    grade: v.grader ? (v.grade ?? null) : null,
    certNumber: v.grader ? (v.certNumber?.trim() || null) : null,
  }));

export type ItemInput = z.infer<typeof itemInput>;

/** Adds copies, merging into an identical existing row (same printing, condition, grade). */
export async function addItem(userId: string, input: ItemInput) {
  const db = await getUserDb();
  if (!input.certNumber && input.purchase == null && !input.notes) {
    const same = await db
      .select({ id: collectionItem.id })
      .from(collectionItem)
      .where(
        and(
          eq(collectionItem.userId, userId),
          eq(collectionItem.cardId, input.cardId),
          eq(collectionItem.finish, input.finish),
          input.condition ? eq(collectionItem.condition, input.condition) : isNull(collectionItem.condition),
          input.grader ? eq(collectionItem.grader, input.grader) : isNull(collectionItem.grader),
          input.grade != null ? eq(collectionItem.grade, String(input.grade)) : isNull(collectionItem.grade),
          isNull(collectionItem.certNumber),
        ),
      )
      .limit(1);
    if (same[0]) {
      await db
        .update(collectionItem)
        .set({ quantity: sql`${collectionItem.quantity} + ${input.quantity}`, updatedAt: new Date() })
        .where(and(eq(collectionItem.id, same[0].id), eq(collectionItem.userId, userId)));
      return same[0].id;
    }
  }
  const [row] = await db
    .insert(collectionItem)
    .values({
      userId,
      cardId: input.cardId,
      finish: input.finish,
      condition: input.condition,
      grader: input.grader ?? null,
      grade: input.grade != null ? String(input.grade) : null,
      certNumber: input.certNumber,
      quantity: input.quantity,
      purchaseCents: input.purchase ?? null,
      valueOverrideCents: input.valueOverride ?? null,
      acquiredOn: input.acquiredOn ?? null,
      notes: input.notes ?? null,
    })
    .returning({ id: collectionItem.id });
  return row.id;
}

export async function updateItem(userId: string, id: string, input: ItemInput) {
  const db = await getUserDb();
  await db
    .update(collectionItem)
    .set({
      finish: input.finish,
      condition: input.condition,
      grader: input.grader ?? null,
      grade: input.grade != null ? String(input.grade) : null,
      certNumber: input.certNumber,
      quantity: input.quantity,
      purchaseCents: input.purchase ?? null,
      valueOverrideCents: input.valueOverride ?? null,
      acquiredOn: input.acquiredOn ?? null,
      notes: input.notes ?? null,
      updatedAt: new Date(),
    })
    .where(and(eq(collectionItem.id, id), eq(collectionItem.userId, userId)));
}

export async function removeItem(userId: string, id: string) {
  const db = await getUserDb();
  await db.delete(collectionItem).where(and(eq(collectionItem.id, id), eq(collectionItem.userId, userId)));
}

export async function rawItems(userId: string) {
  const db = await getUserDb();
  return db
    .select()
    .from(collectionItem)
    .where(eq(collectionItem.userId, userId))
    .orderBy(desc(collectionItem.createdAt));
}

export interface OwnedItem {
  id: string;
  cardId: string;
  card: CatalogCard | null;
  finish: string;
  condition: string | null;
  grader: string | null;
  grade: string | null;
  certNumber: string | null;
  quantity: number;
  purchaseCents: number | null;
  valueOverrideCents: number | null;
  acquiredOn: string | null;
  notes: string | null;
  createdAt: string;
  /** Per-copy value in dollars. */
  unitValue: number | null;
  valueSource: ValueSource;
  estimate: boolean;
  /** Market price of the printing in Near Mint, before condition. */
  marketNm: number | null;
}

/** The whole collection with catalog data and current values attached. */
export async function valuedCollection(userId: string): Promise<OwnedItem[]> {
  const rows = await rawItems(userId);
  const ids = [...new Set(rows.map((r) => r.cardId))];
  const cards = cardsByIds(ids);
  const prices = finishPrices(ids);
  const graded = await gradedPrices(rows.filter((r) => r.grader === "PSA").map((r) => r.cardId));
  return rows.map((r) => {
    const card = cards.get(r.cardId) ?? null;
    const finishPrice = prices.get(r.cardId)?.get(r.finish);
    const v = unitValue(
      { finish: r.finish, condition: r.condition, grader: r.grader, grade: r.grade, valueOverrideCents: r.valueOverrideCents },
      { finishPrice, cardPrice: card?.marketPrice ?? null, psa: graded.get(r.cardId) },
    );
    return {
      id: r.id,
      cardId: r.cardId,
      card,
      finish: r.finish,
      condition: r.condition,
      grader: r.grader,
      grade: r.grade,
      certNumber: r.certNumber,
      quantity: r.quantity,
      purchaseCents: r.purchaseCents,
      valueOverrideCents: r.valueOverrideCents,
      acquiredOn: r.acquiredOn,
      notes: r.notes,
      createdAt: r.createdAt.toISOString(),
      unitValue: v.value,
      valueSource: v.source,
      estimate: v.estimate,
      marketNm: finishPrice ?? card?.marketPrice ?? null,
    };
  });
}

export interface Totals {
  copies: number;
  unique: number;
  value: number;
  cost: number;
  costKnown: number;
  unpriced: number;
}

export function totals(items: OwnedItem[]): Totals {
  let copies = 0;
  let value = 0;
  let cost = 0;
  let costKnown = 0;
  let unpriced = 0;
  for (const i of items) {
    copies += i.quantity;
    if (i.unitValue != null) value += i.unitValue * i.quantity;
    else unpriced += i.quantity;
    if (i.purchaseCents != null) {
      cost += (i.purchaseCents / 100) * i.quantity;
      costKnown += i.quantity;
    }
  }
  return { copies, unique: new Set(items.map((i) => i.cardId)).size, value, cost, costKnown, unpriced };
}

export interface Settings {
  gradingFeeCents: number;
  gradingShippingCents: number;
  defaultCondition: string;
  defaultRegion: "en" | "ja";
}

export async function getSettings(userId: string): Promise<Settings> {
  const db = await getUserDb();
  const [row] = await db.select().from(userSettings).where(eq(userSettings.userId, userId));
  return {
    gradingFeeCents: row?.gradingFeeCents ?? 2500,
    gradingShippingCents: row?.gradingShippingCents ?? 500,
    defaultCondition: row?.defaultCondition ?? "NM",
    defaultRegion: row?.defaultRegion === "ja" ? "ja" : "en",
  };
}

export const settingsInput = z.object({
  gradingFee: money,
  gradingShipping: money,
  defaultCondition: z.enum(CONDITIONS.map((c) => c.code) as [string, ...string[]]),
  defaultRegion: z.enum(["en", "ja"]),
});

export async function saveSettings(userId: string, s: z.infer<typeof settingsInput>) {
  const db = await getUserDb();
  const values = {
    userId,
    gradingFeeCents: s.gradingFee ?? 0,
    gradingShippingCents: s.gradingShipping ?? 0,
    defaultCondition: s.defaultCondition,
    defaultRegion: s.defaultRegion,
    updatedAt: new Date(),
  };
  await db.insert(userSettings).values(values).onConflictDoUpdate({ target: userSettings.userId, set: values });
}

/** Takes copies back off a row (the undo for an add), deleting it at zero. */
export async function decrementItem(userId: string, id: string, by: number) {
  const db = await getUserDb();
  const [row] = await db
    .select({ quantity: collectionItem.quantity })
    .from(collectionItem)
    .where(and(eq(collectionItem.id, id), eq(collectionItem.userId, userId)));
  if (!row) return;
  if (row.quantity <= by) await removeItem(userId, id);
  else
    await db
      .update(collectionItem)
      .set({ quantity: row.quantity - by, updatedAt: new Date() })
      .where(and(eq(collectionItem.id, id), eq(collectionItem.userId, userId)));
}

/** cardId -> printing -> copies owned, for "you have 2" badges. */
export async function ownedCounts(userId: string, cardIds?: string[]) {
  const rows = await rawItems(userId);
  const out = new Map<string, Map<string, number>>();
  const want = cardIds ? new Set(cardIds) : null;
  for (const r of rows) {
    if (want && !want.has(r.cardId)) continue;
    const m = out.get(r.cardId) ?? new Map<string, number>();
    m.set(r.finish, (m.get(r.finish) ?? 0) + r.quantity);
    out.set(r.cardId, m);
  }
  return out;
}
