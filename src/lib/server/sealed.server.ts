import { and, desc, eq, gte, inArray, sql } from "drizzle-orm";
import { z } from "zod";
import { getDb } from "@/lib/db.server";
import { CATEGORY_LABELS, holding, signal, trend, type Holding, type PricePoint, type Signal, type Trend } from "@/lib/sealed";
import { cents } from "@/lib/valuation";
import { getUserDb } from "./db.server";
import { sealedLot, sealedPrice, sealedSale, sealedWatch, userSettings } from "./schema";

/**
 * The opt-in sealed inventory. Catalog reads come from SQLite
 * (sealed_catalog); lots, sales, watches and the shared price history live in
 * Postgres. Every user query filters on the session's user id.
 */

export { CATEGORY_LABELS };

export interface SealedProduct {
  productId: number;
  name: string;
  category: string;
  setId: string;
  setName: string;
  region: "en" | "ja";
  releaseDate: string | null;
  image: string | null;
  url: string | null;
  market: number | null;
}

const PRODUCT_SQL = `SELECT sc.product_id, sc.name, sc.category, sc.set_id, s.name set_name, sc.region,
  s.release_date, sc.image, sc.url, sc.market
  FROM sealed_catalog sc JOIN sets s ON s.id = sc.set_id`;

function toProduct(r: Record<string, unknown>): SealedProduct {
  return {
    productId: r.product_id as number,
    name: r.name as string,
    category: r.category as string,
    setId: r.set_id as string,
    setName: r.set_name as string,
    region: r.region as "en" | "ja",
    releaseDate: (r.release_date as string) ?? null,
    image: (r.image as string) ?? null,
    url: (r.url as string) ?? null,
    market: (r.market as number) ?? null,
  };
}

export function searchSealed(query: string, region: "en" | "ja", category: string | null, limit = 60): SealedProduct[] {
  const tokens = query.trim().toLowerCase().split(/\s+/).filter(Boolean).slice(0, 6);
  const where = ["sc.region = @region"];
  const params: Record<string, unknown> = { region, limit };
  if (category) {
    where.push("sc.category = @category");
    params.category = category;
  }
  tokens.forEach((t, i) => {
    where.push(`(lower(sc.name) LIKE @t${i} OR lower(s.name) LIKE @t${i})`);
    params[`t${i}`] = `%${t}%`;
  });
  if (!tokens.length && !category) return [];
  return (
    getDb()
      .prepare(`${PRODUCT_SQL} WHERE ${where.join(" AND ")} ORDER BY s.release_date DESC, sc.market DESC LIMIT @limit`)
      .all(params) as Record<string, unknown>[]
  ).map(toProduct);
}

export function sealedProducts(ids: number[]): Map<number, SealedProduct> {
  const out = new Map<number, SealedProduct>();
  for (let i = 0; i < ids.length; i += 500) {
    const chunk = ids.slice(i, i + 500);
    if (!chunk.length) continue;
    const rows = getDb()
      .prepare(`${PRODUCT_SQL} WHERE sc.product_id IN (${chunk.map(() => "?").join(",")})`)
      .all(...chunk) as Record<string, unknown>[];
    for (const r of rows) out.set(r.product_id as number, toProduct(r));
  }
  return out;
}

// ------------------------------------------------------------- settings

export async function sealedEnabled(userId: string): Promise<boolean> {
  const db = await getUserDb();
  const [row] = await db.select({ on: userSettings.sealedEnabled }).from(userSettings).where(eq(userSettings.userId, userId));
  return row?.on ?? false;
}

export async function setSealedEnabled(userId: string, on: boolean) {
  const db = await getUserDb();
  await db
    .insert(userSettings)
    .values({ userId, sealedEnabled: on })
    .onConflictDoUpdate({ target: userSettings.userId, set: { sealedEnabled: on, updatedAt: new Date() } });
}

// ---------------------------------------------------------- price history

/** Recorded market prices per product, oldest first, from `days` ago. */
export async function priceHistory(productIds: number[], days = 3650): Promise<Map<number, PricePoint[]>> {
  const out = new Map<number, PricePoint[]>();
  if (!productIds.length) return out;
  const db = await getUserDb();
  const since = new Date(Date.now() - days * 86_400_000).toISOString().slice(0, 10);
  const rows = await db
    .select()
    .from(sealedPrice)
    .where(and(inArray(sealedPrice.productId, productIds), gte(sealedPrice.day, since)))
    .orderBy(sealedPrice.day);
  for (const r of rows) {
    if (r.market == null) continue;
    const list = out.get(r.productId) ?? [];
    list.push({ day: String(r.day), market: Number(r.market) });
    out.set(r.productId, list);
  }
  return out;
}

// ------------------------------------------------------------- inventory

export interface Position {
  product: SealedProduct;
  holding: Holding;
  /** Market value of the units held. */
  value: number | null;
  unrealized: number | null;
  trend: Trend | null;
  signal: Signal;
  /** Last 90 days of prices, for the sparkline. */
  spark: PricePoint[];
  watched: boolean;
}

export async function inventory(userId: string) {
  const db = await getUserDb();
  const [lots, sales, watches] = await Promise.all([
    db.select().from(sealedLot).where(eq(sealedLot.userId, userId)),
    db.select().from(sealedSale).where(eq(sealedSale.userId, userId)),
    db.select().from(sealedWatch).where(eq(sealedWatch.userId, userId)),
  ]);
  const ids = [...new Set([...lots.map((l) => l.productId), ...sales.map((s) => s.productId), ...watches.map((w) => w.productId)])];
  const products = sealedProducts(ids);
  const history = await priceHistory(ids, 120);
  const watched = new Set(watches.map((w) => w.productId));

  const positions: Position[] = [];
  for (const id of ids) {
    const product = products.get(id);
    if (!product) continue;
    const h = holding(
      lots.filter((l) => l.productId === id),
      sales.filter((s) => s.productId === id),
    );
    const pts = history.get(id) ?? [];
    const t = trend(pts);
    const price = product.market ?? t?.current ?? null;
    positions.push({
      product,
      holding: h,
      value: price != null ? price * h.held : null,
      unrealized: price != null && h.avgCost != null ? (price - h.avgCost) * h.held : null,
      trend: t,
      signal: signal(t, h.avgCost, h.held > 0),
      spark: pts.slice(-90),
      watched: watched.has(id),
    });
  }
  const held = positions.filter((p) => p.holding.held > 0);
  const totals = {
    units: held.reduce((n, p) => n + p.holding.held, 0),
    value: held.reduce((n, p) => n + (p.value ?? 0), 0),
    cost: held.reduce((n, p) => n + p.holding.costBasis, 0),
    realized: positions.reduce((n, p) => n + p.holding.realized, 0),
  };
  return { positions, totals };
}

export async function productLedger(userId: string, productId: number) {
  const db = await getUserDb();
  const [lots, sales, watch] = await Promise.all([
    db.select().from(sealedLot).where(and(eq(sealedLot.userId, userId), eq(sealedLot.productId, productId))).orderBy(desc(sealedLot.createdAt)),
    db.select().from(sealedSale).where(and(eq(sealedSale.userId, userId), eq(sealedSale.productId, productId))).orderBy(desc(sealedSale.createdAt)),
    db.select().from(sealedWatch).where(and(eq(sealedWatch.userId, userId), eq(sealedWatch.productId, productId))),
  ]);
  return { lots, sales, watched: watch.length > 0, holding: holding(lots, sales) };
}

// --------------------------------------------------------------- writes

const money = z
  .string()
  .transform((v) => v.replace(/[$,\s]/g, ""))
  .pipe(z.string().regex(/^\d{1,7}(\.\d{1,2})?$/, "Enter an amount like 129.99"))
  .transform((v) => cents(Number(v))!);
const day = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .optional()
  .or(z.literal("").transform(() => undefined));

export const lotInput = z.object({
  productId: z.coerce.number().int().positive(),
  quantity: z.coerce.number().int().min(1).max(10_000),
  unitCost: money,
  boughtOn: day,
  notes: z.string().max(300).optional(),
});

export const saleInput = z.object({
  productId: z.coerce.number().int().positive(),
  quantity: z.coerce.number().int().min(1).max(10_000),
  unitPrice: money,
  fees: money.optional().or(z.literal("").transform(() => undefined)),
  soldOn: day,
  notes: z.string().max(300).optional(),
});

export async function addLot(userId: string, v: z.infer<typeof lotInput>) {
  if (!sealedProducts([v.productId]).size) throw new Error("That product isn't in the catalog.");
  const db = await getUserDb();
  await db.insert(sealedLot).values({
    userId,
    productId: v.productId,
    quantity: v.quantity,
    unitCostCents: v.unitCost,
    boughtOn: v.boughtOn ?? null,
    notes: v.notes?.trim() || null,
  });
}

export async function addSale(userId: string, v: z.infer<typeof saleInput>) {
  const { holding: h } = await productLedger(userId, v.productId);
  if (v.quantity > h.held) throw new Error(`You only hold ${h.held}.`);
  const db = await getUserDb();
  await db.insert(sealedSale).values({
    userId,
    productId: v.productId,
    quantity: v.quantity,
    unitPriceCents: v.unitPrice,
    feesCents: v.fees ?? 0,
    soldOn: v.soldOn ?? null,
    notes: v.notes?.trim() || null,
  });
}

export async function deleteLot(userId: string, id: string) {
  if (!z.uuid().safeParse(id).success) return;
  const db = await getUserDb();
  await db.delete(sealedLot).where(and(eq(sealedLot.id, id), eq(sealedLot.userId, userId)));
}

export async function deleteSale(userId: string, id: string) {
  if (!z.uuid().safeParse(id).success) return;
  const db = await getUserDb();
  await db.delete(sealedSale).where(and(eq(sealedSale.id, id), eq(sealedSale.userId, userId)));
}

export async function setWatch(userId: string, productId: number, on: boolean) {
  const db = await getUserDb();
  await db.delete(sealedWatch).where(and(eq(sealedWatch.userId, userId), eq(sealedWatch.productId, productId)));
  if (on && sealedProducts([productId]).size) await db.insert(sealedWatch).values({ userId, productId });
}

/** Products the user holds or watches, by id, for badges on search results. */
export async function myProductIds(userId: string) {
  const db = await getUserDb();
  const [lots, watches] = await Promise.all([
    db.select({ id: sealedLot.productId, q: sql<number>`sum(${sealedLot.quantity})` }).from(sealedLot).where(eq(sealedLot.userId, userId)).groupBy(sealedLot.productId),
    db.select({ id: sealedWatch.productId }).from(sealedWatch).where(eq(sealedWatch.userId, userId)),
  ]);
  return { bought: new Map(lots.map((l) => [l.id, Number(l.q)])), watched: new Set(watches.map((w) => w.id)) };
}

/** Every sealed purchase and sale, for the user's data export. */
export async function sealedExport(userId: string) {
  const db = await getUserDb();
  const [lots, sales, watches] = await Promise.all([
    db.select().from(sealedLot).where(eq(sealedLot.userId, userId)),
    db.select().from(sealedSale).where(eq(sealedSale.userId, userId)),
    db.select().from(sealedWatch).where(eq(sealedWatch.userId, userId)),
  ]);
  const products = sealedProducts([...new Set([...lots, ...sales, ...watches].map((r) => r.productId))]);
  const name = (id: number) => products.get(id)?.name ?? null;
  return {
    purchases: lots.map((l) => ({ productId: l.productId, product: name(l.productId), quantity: l.quantity, paidEach: l.unitCostCents / 100, boughtOn: l.boughtOn, notes: l.notes })),
    sales: sales.map((s) => ({ productId: s.productId, product: name(s.productId), quantity: s.quantity, soldEach: s.unitPriceCents / 100, fees: s.feesCents / 100, soldOn: s.soldOn, notes: s.notes })),
    watching: watches.map((w) => ({ productId: w.productId, product: name(w.productId) })),
  };
}
