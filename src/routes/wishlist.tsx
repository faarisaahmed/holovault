import { Form, Link, useFetcher } from "react-router";
import type { Route } from "./+types/wishlist";
import { finishShort } from "@/components/finish";
import { usd } from "@/lib/format";
import { requireUser } from "@/lib/server/auth.server";
import { addItem, getSettings, itemInput } from "@/lib/server/collection.server";
import { finishPrices, finishesFor, getCard } from "@/lib/server/catalog.server";
import { addWish, removeWish, setWishTarget, wishlist, type Wish } from "@/lib/server/wishlist.server";

export const meta: Route.MetaFunction = () => [{ title: "Wishlist — Shadowless" }];

export async function loader({ request }: Route.LoaderArgs) {
  const user = await requireUser(request);
  const wishes = (await wishlist(user.id)).sort(
    (a, b) => Number(!!b.flag) - Number(!!a.flag) || (b.price ?? 0) - (a.price ?? 0),
  );
  const settings = await getSettings(user.id);
  return { wishes, defaultCondition: settings.defaultCondition };
}

export async function action({ request }: Route.ActionArgs) {
  const user = await requireUser(request);
  const form = await request.formData();
  const id = String(form.get("id") ?? "");
  const intent = String(form.get("intent"));
  if (intent === "want") return addWish(user.id, Object.fromEntries([...form.entries()].filter(([, v]) => v !== "")));
  if (intent === "remove") {
    await removeWish(user.id, id);
    return { ok: true };
  }
  if (intent === "target") return setWishTarget(user.id, id, String(form.get("target") ?? "") || null);
  if (intent === "got") {
    // Bought it: add a copy to the collection and take it off the list.
    const cardId = String(form.get("cardId") ?? "");
    const prices = finishPrices([cardId]).get(cardId);
    const wanted = String(form.get("finish") ?? "");
    const card = getCard(cardId);
    if (!card) return { error: "That card isn't in the catalog." };
    const finish = wanted || finishesFor(card, prices)[0] || "Normal";
    const parsed = itemInput.safeParse({ cardId, finish, condition: form.get("condition") || "NM", quantity: 1, purchase: form.get("paid") || null });
    if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Check the form." };
    await addItem(user.id, parsed.data);
    await removeWish(user.id, id);
    return { ok: true, got: card.name };
  }
  return { error: "Unknown request." };
}

export default function Wishlist({ loaderData, actionData }: Route.ComponentProps) {
  const { wishes, defaultCondition } = loaderData;
  const total = wishes.reduce((s, w) => s + (w.owned ? 0 : (w.price ?? 0)), 0);
  const flagged = wishes.filter((w) => w.flag).length;

  return (
    <>
      <div className="mb-4 flex flex-wrap items-end gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Wishlist</h1>
          <p className="mt-1 text-sm text-ink-400">
            {wishes.length ? `${wishes.length} cards · ${usd(total)} to get them all` : "Cards you're hunting."}
            {flagged ? <span className="text-good"> · {flagged} worth a look now</span> : null}
          </p>
        </div>
        <Link to="/add" className="ml-auto rounded-md bg-accent px-3 py-1.5 text-xs font-semibold text-black">
          Find cards to want
        </Link>
      </div>
      {actionData && "got" in actionData && actionData.got ? (
        <p className="mb-3 rounded-lg border border-good/30 bg-good/10 px-3 py-2 text-sm text-good">Added {actionData.got} to your collection.</p>
      ) : null}

      {wishes.length === 0 ? (
        <p className="rounded-xl border border-dashed border-ink-700 px-4 py-14 text-center text-sm text-ink-400">
          Nothing here yet. Tap <strong className="text-ink-200">♡ Want</strong> on any card in{" "}
          <Link to="/add" className="text-accent underline">
            Add cards
          </Link>{" "}
          or an empty binder pocket. Set a target price and it'll be flagged when the market gets there.
        </p>
      ) : (
        <ul className="divide-y divide-ink-850 overflow-hidden rounded-xl border border-ink-800 bg-ink-900">
          {wishes.map((w) => (
            <WishRow key={w.id} w={w} defaultCondition={defaultCondition} />
          ))}
        </ul>
      )}
      <p className="mt-3 max-w-3xl text-[11px] text-ink-500">
        Flags: <span className="text-good">under your target</span>, or <span className="text-amber-300">down 10%+</span> on the
        price when you added it or this week's high. Prices are TCGplayer market, refreshed daily.
      </p>
    </>
  );
}

function WishRow({ w, defaultCondition }: { w: Wish; defaultCondition: string }) {
  const f = useFetcher();
  const busy = f.state !== "idle";
  const change = w.price != null && w.priceAtAdd ? w.price / w.priceAtAdd - 1 : null;
  return (
    <li className={`flex flex-wrap items-center gap-3 px-3 py-2.5 ${busy ? "opacity-60" : ""}`}>
      {w.card.image ? <img src={w.card.image} alt="" loading="lazy" className="h-16 w-auto shrink-0 rounded-sm ring-1 ring-ink-700" /> : null}
      <div className="min-w-0 flex-1">
        <div className="truncate text-sm font-medium">
          {w.card.name}
          {w.owned ? <span className="ml-2 rounded bg-good/15 px-1.5 py-0.5 text-[10px] font-semibold text-good">have {w.owned}</span> : null}
        </div>
        <div className="truncate text-[11px] text-ink-500">
          {w.card.setName} · {w.card.localId} · {w.finish ? finishShort(w.finish) : "any printing"}
        </div>
        {w.flag === "target" ? (
          <div className="mt-0.5 text-[11px] font-semibold text-good">✓ Under your {usd(w.target)} target</div>
        ) : w.flag === "drop" ? (
          <div className="mt-0.5 text-[11px] font-semibold text-amber-300">↓ Dropped, worth a look</div>
        ) : null}
      </div>
      <div className="w-24 shrink-0 text-right">
        <div className="tnum text-sm font-semibold text-accent">{usd(w.price)}</div>
        {change != null && Math.abs(change) >= 0.01 ? (
          <div className={`tnum text-[10px] ${change < 0 ? "text-good" : "text-rose-300"}`}>
            {change < 0 ? "↓" : "↑"} {Math.abs(change * 100).toFixed(0)}% since added
          </div>
        ) : (
          <div className="text-[10px] text-ink-600">since added</div>
        )}
      </div>
      <div className="flex w-full items-center gap-2 sm:w-auto">
        <f.Form method="post" className="flex items-center gap-1">
          <input type="hidden" name="intent" value="target" />
          <input type="hidden" name="id" value={w.id} />
          <input
            name="target"
            inputMode="decimal"
            defaultValue={w.target != null ? w.target.toFixed(2) : ""}
            placeholder="Target $"
            aria-label="Target price"
            className="h-8 w-20 rounded-md border border-ink-700 bg-ink-850 px-2 text-xs"
          />
          <button className="h-8 rounded-md border border-ink-700 px-2 text-[11px] text-ink-300 hover:border-accent">Set</button>
        </f.Form>
        <Form method="post" className="ml-auto sm:ml-0">
          <input type="hidden" name="intent" value="got" />
          <input type="hidden" name="id" value={w.id} />
          <input type="hidden" name="cardId" value={w.card.id} />
          <input type="hidden" name="finish" value={w.finish ?? ""} />
          <input type="hidden" name="condition" value={defaultCondition} />
          <button className="h-8 rounded-md bg-accent/15 px-2.5 text-[11px] font-semibold text-accent ring-1 ring-accent/30" title="Add a copy to your collection and take it off the list">
            Got it
          </button>
        </Form>
        <f.Form method="post">
          <input type="hidden" name="intent" value="remove" />
          <input type="hidden" name="id" value={w.id} />
          <button aria-label="Remove from wishlist" className="grid h-8 w-8 place-items-center text-ink-500 hover:text-rose-300">
            ✕
          </button>
        </f.Form>
      </div>
    </li>
  );
}
