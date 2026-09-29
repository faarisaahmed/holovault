import { randomBytes } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { paginate, planSlots } from "@/lib/binder";
import { binderCandidates, getBinder } from "./binder.server";
import { valuedCollection } from "./collection.server";
import { getUserDb } from "./db.server";
import { binder, user, userSettings } from "./schema";

/**
 * Read-only share links. Off unless the owner turns one on; the token is
 * random and unguessable, and turning sharing off (or on again) retires the
 * old link. Shared pages never show what was paid, notes, cert numbers or
 * anything account-related, and only show values if the owner says so.
 */

const newToken = () => randomBytes(12).toString("base64url");
const TOKEN = /^[A-Za-z0-9_-]{16}$/;

export async function setBinderShare(userId: string, binderId: string, on: boolean) {
  const db = await getUserDb();
  await db
    .update(binder)
    .set({ shareToken: on ? newToken() : null })
    .where(and(eq(binder.id, binderId), eq(binder.userId, userId)));
}

export async function binderShareToken(userId: string, binderId: string): Promise<string | null> {
  const db = await getUserDb();
  const [row] = await db
    .select({ t: binder.shareToken })
    .from(binder)
    .where(and(eq(binder.id, binderId), eq(binder.userId, userId)));
  return row?.t ?? null;
}

export async function setCollectionShare(userId: string, on: boolean, showValues: boolean) {
  const db = await getUserDb();
  const [cur] = await db.select({ t: userSettings.shareToken }).from(userSettings).where(eq(userSettings.userId, userId));
  const token = on ? (cur?.t ?? newToken()) : null;
  await db
    .insert(userSettings)
    .values({ userId, shareToken: token, shareShowValues: showValues })
    .onConflictDoUpdate({ target: userSettings.userId, set: { shareToken: token, shareShowValues: showValues, updatedAt: new Date() } });
}

/** First name only: enough to say whose binder it is. */
async function ownerName(userId: string) {
  const db = await getUserDb();
  const [u] = await db.select({ name: user.name }).from(user).where(eq(user.id, userId));
  return (u?.name ?? "").trim().split(/\s+/)[0] || "A collector";
}

export async function sharedBinder(token: string) {
  if (!TOKEN.test(token)) return null;
  const db = await getUserDb();
  const [row] = await db.select({ id: binder.id, userId: binder.userId }).from(binder).where(eq(binder.shareToken, token));
  if (!row) return null;
  const b = await getBinder(row.userId, row.id);
  if (!b) return null;
  const { cards, species } = await binderCandidates(row.userId, b.config);
  const slots = planSlots(cards, b.config, species);
  const pages = paginate(slots, b.rows * b.cols, b.config).map((p) =>
    p.map((s) => ({
      key: s.key,
      owned: s.owned,
      label: s.label,
      card: s.card ? { name: s.card.name, setName: s.card.setName, localId: s.card.localId, image: s.card.image } : null,
    })),
  );
  return {
    owner: await ownerName(row.userId),
    name: b.name,
    rows: b.rows,
    cols: b.cols,
    pages,
    total: slots.length,
    owned: slots.filter((s) => s.owned).length,
  };
}

export async function sharedCollection(token: string) {
  if (!TOKEN.test(token)) return null;
  const db = await getUserDb();
  const [s] = await db
    .select({ userId: userSettings.userId, show: userSettings.shareShowValues })
    .from(userSettings)
    .where(eq(userSettings.shareToken, token));
  if (!s) return null;
  const items = (await valuedCollection(s.userId))
    .filter((i) => i.card)
    .sort((a, b) => (b.unitValue ?? 0) - (a.unitValue ?? 0))
    .map((i) => ({
      id: i.id,
      name: i.card!.name,
      setName: i.card!.setName,
      localId: i.card!.localId,
      image: i.card!.image,
      finish: i.finish,
      condition: i.condition,
      grader: i.grader,
      grade: i.grade,
      quantity: i.quantity,
      value: s.show ? i.unitValue : null,
    }));
  return {
    owner: await ownerName(s.userId),
    showValues: s.show,
    items,
    copies: items.reduce((n, i) => n + i.quantity, 0),
    total: s.show ? items.reduce((n, i) => n + (i.value ?? 0) * i.quantity, 0) : null,
  };
}

export async function collectionShare(userId: string): Promise<{ token: string | null; showValues: boolean }> {
  const db = await getUserDb();
  const [row] = await db
    .select({ t: userSettings.shareToken, v: userSettings.shareShowValues })
    .from(userSettings)
    .where(eq(userSettings.userId, userId));
  return { token: row?.t ?? null, showValues: row?.v ?? false };
}
