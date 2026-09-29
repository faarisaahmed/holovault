import { useCallback, useState } from "react";
import { useActionData, useFetcher, useNavigation } from "react-router";
import type { Route } from "./+types/add";
import { AddPanel, type AddableCard } from "@/components/add-panel";
import { SearchBox, Toggle } from "@/components/controls";
import { finishShort } from "@/components/finish";
import { AddedToast, type Added } from "@/components/toast";
import { usd } from "@/lib/format";
import { requireUser } from "@/lib/server/auth.server";
import { handleCardAction, type CardActionResult } from "@/lib/server/card-actions.server";
import { finishPrices, finishesFor, searchCards } from "@/lib/server/catalog.server";
import { getSettings, ownedCounts } from "@/lib/server/collection.server";
import type { Region } from "@/lib/types";

export const meta: Route.MetaFunction = () => [{ title: "Add cards — Shadowless" }];

export async function loader({ request }: Route.LoaderArgs) {
  const user = await requireUser(request);
  const settings = await getSettings(user.id);
  const sp = new URL(request.url).searchParams;
  const q = sp.get("q") ?? "";
  const region = (sp.get("region") ?? settings.defaultRegion) as Region;
  const found = q.trim().length >= 2 ? searchCards(q, region === "ja" ? "ja" : "en", 60) : [];
  const prices = finishPrices(found.map((c) => c.id));
  const owned = await ownedCounts(user.id, found.map((c) => c.id));
  const cards: (AddableCard & { owned: Record<string, number> })[] = found.map((c) => {
    const p = prices.get(c.id);
    return {
      id: c.id,
      name: c.name,
      setName: c.setName,
      localId: c.localId,
      officialCount: c.officialCount,
      image: c.image,
      finishes: finishesFor(c, p).map((f) => ({ name: f, price: p?.get(f) ?? (f === "Normal" || f === "Holofoil" ? c.marketPrice : null) })),
      owned: Object.fromEntries(owned.get(c.id) ?? []),
    };
  });
  return { q, region, cards, defaultCondition: settings.defaultCondition };
}

export async function action({ request }: Route.ActionArgs) {
  const user = await requireUser(request);
  return (await handleCardAction(user.id, await request.formData())) ?? { error: "Unknown request." };
}

export default function AddCards({ loaderData }: Route.ComponentProps) {
  const { q, region, cards, defaultCondition } = loaderData;
  const [open, setOpen] = useState<string | null>(null);
  const [dismissedAt, setDismissedAt] = useState(0);
  const quick = useFetcher<CardActionResult>();
  const full = useActionData<typeof action>() as CardActionResult | undefined;
  const searching = useNavigation().state === "loading";

  // The most recent add from either the quick buttons or the full panel.
  const latest = [quick.data, full]
    .map((d) => (d && "added" in d ? d.added : null))
    .filter((a): a is Added => !!a)
    .sort((a, b) => b.at - a.at)[0];
  const toast = latest && latest.at > dismissedAt ? latest : null;
  const close = useCallback(() => setOpen(null), []);
  const clearToast = useCallback(() => setDismissedAt(Date.now()), []);

  return (
    <>
      <div className="mb-4">
        <h1 className="text-2xl font-semibold tracking-tight">Add cards</h1>
        <p className="mt-1 max-w-3xl text-sm text-ink-400">
          Search by name, set or number — <code className="text-ink-300">charizard 151</code>,{" "}
          <code className="text-ink-300">umbreon 215</code>, <code className="text-ink-300">sv03.5 199</code>. The
          quick buttons add one copy in {defaultCondition}; click a card for condition, grading, quantity and price
          paid.
        </p>
      </div>
      <div className="mb-5 flex flex-wrap items-center gap-2">
        <SearchBox name="q" placeholder="Search cards…" value={q} />
        <Toggle
          name="region"
          value={region}
          options={[
            { value: "en", label: "English" },
            { value: "ja", label: "Japanese" },
          ]}
        />
        {searching ? <span className="text-xs text-ink-500">Searching…</span> : null}
      </div>

      {q.trim().length < 2 ? (
        <p className="rounded-xl border border-dashed border-ink-700 px-4 py-14 text-center text-sm text-ink-400">
          Start typing to find a card. Have a spreadsheet already?{" "}
          <a href="/import" className="text-accent underline">
            Import it
          </a>
          .
        </p>
      ) : cards.length === 0 ? (
        <p className="rounded-xl border border-ink-800 bg-ink-900 px-4 py-14 text-center text-sm text-ink-400">
          No cards match “{q}”.
        </p>
      ) : (
        <div className="grid grid-cols-2 gap-x-3 gap-y-5 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6">
          {cards.map((c) => {
            const total = Object.values(c.owned).reduce((a, b) => a + b, 0);
            return (
              <div key={c.id} className={open === c.id ? "col-span-2 sm:col-span-3 md:col-span-4 lg:col-span-6" : ""}>
                {open === c.id ? (
                  <AddPanel card={c} defaultCondition={defaultCondition} onDone={close} />
                ) : (
                  <div className="flex flex-col">
                    <button onClick={() => setOpen(c.id)} className="group relative overflow-hidden rounded-lg bg-ink-850 ring-1 ring-ink-800 transition hover:-translate-y-0.5 hover:ring-accent" title="More options">
                      {c.image ? (
                        <img src={c.image} alt={c.name} loading="lazy" className="aspect-[245/342] w-full object-cover" />
                      ) : (
                        <div className="grid aspect-[245/342] place-items-center px-2 text-[10px] text-ink-600">{c.name}</div>
                      )}
                      {total ? (
                        <span className="absolute right-1 top-1 rounded bg-good px-1.5 py-0.5 text-[10px] font-bold text-black">
                          ×{total} owned
                        </span>
                      ) : null}
                    </button>
                    <div className="mt-1.5 truncate px-0.5 text-[11px] text-ink-200">{c.name}</div>
                    <div className="truncate px-0.5 text-[10px] text-ink-500">
                      {c.setName} · {c.localId}
                    </div>
                    <div className="mt-1 flex flex-wrap gap-1">
                      {c.finishes.map((f) => (
                        <quick.Form method="post" key={f.name}>
                          <input type="hidden" name="intent" value="add" />
                          <input type="hidden" name="cardId" value={c.id} />
                          <input type="hidden" name="finish" value={f.name} />
                          <input type="hidden" name="condition" value={defaultCondition} />
                          <button
                            title={`Add one ${f.name} copy (${defaultCondition})`}
                            className="rounded border border-ink-700 bg-ink-850 px-1.5 py-0.5 text-[10px] text-ink-300 transition-colors hover:border-accent hover:text-accent"
                          >
                            + {finishShort(f.name)}
                            {c.owned[f.name] ? <span className="ml-1 text-good">{c.owned[f.name]}</span> : null}
                            <span className="ml-1 text-ink-500">{usd(f.price, { compact: true })}</span>
                          </button>
                        </quick.Form>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
      <AddedToast added={toast} onClose={clearToast} />
    </>
  );
}
