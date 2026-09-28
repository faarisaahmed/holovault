import { addItem, decrementItem, itemInput } from "./collection.server";
import { finishPrices, finishesFor, getCard } from "./catalog.server";

export type CardActionResult =
  | { ok: true; added: { id: string; name: string; finish: string; label: string; quantity: number; at: number } }
  | { ok: true; undone: true }
  | { error: string };

/**
 * The add / undo intents shared by every page that can add cards in place.
 * The user id always comes from the session, never the form.
 */
export async function handleCardAction(userId: string, form: FormData): Promise<CardActionResult | null> {
  const intent = String(form.get("intent"));
  if (intent === "add") {
    const parsed = itemInput.safeParse(Object.fromEntries([...form.entries()].filter(([, v]) => v !== "")));
    if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Check the form." };
    const card = getCard(parsed.data.cardId);
    if (!card) return { error: "That card isn't in the catalog." };
    const finishes = finishesFor(card, finishPrices([card.id]).get(card.id));
    if (!finishes.includes(parsed.data.finish)) {
      return { error: `${card.name} doesn't come in ${parsed.data.finish}. It's printed as ${finishes.join(" or ")}.` };
    }
    const id = await addItem(userId, parsed.data);
    const label = parsed.data.grader
      ? `${parsed.data.grader} ${parsed.data.grade ?? ""}`.trim()
      : (parsed.data.condition ?? "NM");
    return {
      ok: true,
      added: { id, name: card.name, finish: parsed.data.finish, label, quantity: parsed.data.quantity, at: Date.now() },
    };
  }
  if (intent === "undo") {
    const id = String(form.get("id") ?? "");
    const by = Math.max(1, Number(form.get("quantity")) || 1);
    if (id) await decrementItem(userId, id, by);
    return { ok: true, undone: true };
  }
  return null;
}
