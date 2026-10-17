import { and, count, eq, gt } from "drizzle-orm";
import { getUserDb } from "./db.server";
import { session } from "./schema";

/** Signed-in devices for a user: sessions that haven't expired. */
export async function activeSessionCount(userId: string): Promise<number> {
  const db = await getUserDb();
  const [row] = await db
    .select({ n: count() })
    .from(session)
    .where(and(eq(session.userId, userId), gt(session.expiresAt, new Date())));
  return row?.n ?? 0;
}
