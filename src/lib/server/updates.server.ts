import { eq } from "drizzle-orm";
import { LATEST_UPDATE } from "@/lib/updates";
import { getUserDb } from "./db.server";
import { userSettings } from "./schema";

/**
 * Whether there's a "What's new" entry the user hasn't seen. New accounts
 * start caught up (everything already existed when they joined).
 */
export async function hasNewUpdates(userId: string, joined: Date | string | number): Promise<boolean> {
  const db = await getUserDb();
  const [row] = await db.select({ seen: userSettings.seenUpdates }).from(userSettings).where(eq(userSettings.userId, userId));
  const since = row?.seen ?? new Date(joined).toISOString().slice(0, 10);
  return LATEST_UPDATE > since;
}

export async function markUpdatesSeen(userId: string) {
  const db = await getUserDb();
  await db
    .insert(userSettings)
    .values({ userId, seenUpdates: LATEST_UPDATE })
    .onConflictDoUpdate({ target: userSettings.userId, set: { seenUpdates: LATEST_UPDATE } });
}
