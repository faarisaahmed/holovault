import { useCallback, useEffect, useState } from "react";
import { useFetcher } from "react-router";
import type { Route } from "./+types/trade";
import { finishShort } from "@/components/finish";
import { usd } from "@/lib/format";
import { CONDITIONS, GRADERS, GRADES, unitValue } from "@/lib/valuation";
import { requireUser } from "@/lib/server/auth.server";
import { finishPrices, finishesFor, searchCards } from "@/lib/server/catalog.server";
import { addItem, decrementItem, getSettings, itemInput, valuedCollection } from "@/lib/server/collection.server";
import { gradedPrices } from "@/lib/server/graded.server";
import type { Region } from "@/lib/types";

export const meta: Route.MetaFunction = () => [{ title: "Trade helper — Shadowless" }];

/** A card you could put on either side of a trade, with what's needed to value it. */
export interface TradeCard {
  cardId: string;
  name: string;
  setName: string;
  localId: string;
  image: string | null;
  cardPrice: number | null;
  finishes: { name: string; price: number | null }[];
  /** PSA sold averages by grade, when comps exist. */
  psa: Record<string, number>;
  rarityKey: string | null;
  /** When it's a copy from your collection: which one, and how it's stored. */
  item?: { id: string; finish: string; condition: string | null; grader: string | null; grade: string | null; quantity: number };
}

export async function loader({ request }: Route.LoaderArgs) {
  const user = await requireUser(request);
  const sp = new URL(request.url).searchParams;
  const q = (sp.get("q") ?? "").trim();
  const settings = await getSettings(user.id);
  if (q.length < 2) return { results: [] as TradeCard[], defaultCondition: settings.defaultCondition, region: settings.defaultRegion };
  const region: Region = sp.get("region") === "ja" ? "ja" : "en";
  let results: TradeCard[] = [];
  if (sp.get("side") === "give") {
    // Giving: your own copies first, so recording the trade can take them out.
    const needle = q.toLowerCase();
    const mine = (await valuedCollection(user.id))
      .filter((i) => i.card && `${i.card.name} ${i.card.setName} ${i.card.localId}`.toLowerCase().includes(needle))
      .slice(0, 12);
    results = mine.map((i) => ({
      cardId: i.cardId,
      name: i.card!.name,
      setName: i.card!.setName,
      localId: i.card!.localId,
      image: i.card!.image,
      cardPrice: i.card!.marketPrice,
      rarityKey: i.card!.rarityKey,
      finishes: [],
      psa: {},
      item: { id: i.id, finish: i.finish, condition: i.condition, grader: i.grader, grade: i.grade, quantity: i.quantity },
    }));
  }
  const found = searchCards(q, region, 24);
  results.push(
    ...found.map((c) => ({
      cardId: c.id,
      name: c.name,
      setName: c.setName,
      localId: c.localId,
      image: c.image,
      cardPrice: c.marketPrice,
      rarityKey: c.rarityKey,
      finishes: [],
      psa: {},
    })),
  );
  const ids = [...new Set(results.map((r) => r.cardId))];
  const prices = finishPrices(ids);
  const psa = await gradedPrices(ids);
  for (const r of results) {
    const p = prices.get(r.cardId);
    r.finishes = finishesFor({ id: r.cardId, rarityKey: r.rarityKey }, p).map((f) => ({
      name: f,
      price: p?.get(f) ?? (f === "Normal" || f === "Holofoil" ? r.cardPrice : null),
    }));
    r.psa = Object.fromEntries(psa.get(r.cardId) ?? []);
  }
  return { results, defaultCondition: settings.defaultCondition, region: settings.defaultRegion };
}

interface Line {
  key: string;
  card: TradeCard;
  finish: string;
  condition: string;
  grader: string | null;
  grade: string;
  qty: number;
}

const tradeLine = itemInput;

export async function action({ request }: Route.ActionArgs) {
  const user = await requireUser(request);
  const form = await request.formData();
  if (form.get("intent") !== "record") return { error: "Unknown request." };
  let payload: { give: Line[]; get: Line[] };
  try {
    payload = JSON.parse(String(form.get("trade") ?? "{}"));
  } catch {
    return { error: "Couldn't read the trade." };
  }
  let out = 0;
  let inn = 0;
  // Out: only copies that came from the collection can be taken out of it.
  for (const l of (payload.give ?? []).slice(0, 200)) {
    if (!l.card?.item?.id) continue;
    await decrementItem(user.id, l.card.item.id, Math.max(1, Math.min(999, Number(l.qty) || 1)));
    out += Number(l.qty) || 1;
  }
  for (const l of (payload.get ?? []).slice(0, 200)) {
    const parsed = tradeLine.safeParse({
      cardId: l.card?.cardId,
      finish: l.finish,
      condition: l.grader ? null : l.condition,
      grader: l.grader,
      grade: l.grader ? l.grade : null,
      quantity: l.qty,
    });
    if (!parsed.success) continue;
    await addItem(user.id, { ...parsed.data, notes: "Traded for" });
    inn += parsed.data.quantity;
  }
  return { recorded: { out, in: inn } };
}

/** What one line is worth: market for the printing, discounted for condition, or PSA comps for a slab. */
function lineValue(l: Line): number | null {
  const v = unitValue(
    { finish: l.finish, condition: l.grader ? null : l.condition, grader: l.grader, grade: l.grader ? l.grade : null, valueOverrideCents: null },
    {
      finishPrice: l.card.finishes.find((f) => f.name === l.finish)?.price,
      cardPrice: l.card.cardPrice,
      psa: new Map(Object.entries(l.card.psa)),
    },
  );
  return v.value != null ? v.value * l.qty : null;
}

const DRAFT = "shadowless:trade-draft";

export default function Trade({ loaderData, actionData }: Route.ComponentProps) {
  const [give, setGive] = useState<Line[]>([]);
  const [get, setGet] = useState<Line[]>([]);
  const record = useFetcher<typeof action>();

  // Keep an unfinished trade across reloads on this device.
  const [loaded, setLoaded] = useState(false);
  useEffect(() => {
    try {
      const saved = JSON.parse(window.localStorage.getItem(DRAFT) ?? "null");
      if (saved?.give && saved?.get) {
        queueMicrotask(() => {
          setGive(saved.give);
          setGet(saved.get);
        });
      }
    } catch {
      // No draft, or storage is blocked.
    }
    queueMicrotask(() => setLoaded(true));
  }, []);
  useEffect(() => {
    if (!loaded) return;
    try {
      window.localStorage.setItem(DRAFT, JSON.stringify({ give, get }));
    } catch {
      // Storage blocked: the draft just won't survive a reload.
    }
  }, [give, get, loaded]);

  const recorded = record.data && "recorded" in record.data ? record.data.recorded : null;
  useEffect(() => {
    if (!recorded) return;
    queueMicrotask(() => {
      setGive([]);
      setGet([]);
    });
  }, [recorded]);

  const giveTotal = give.reduce((s, l) => s + (lineValue(l) ?? 0), 0);
  const getTotal = get.reduce((s, l) => s + (lineValue(l) ?? 0), 0);
  const diff = getTotal - giveTotal;
  const bigger = Math.max(giveTotal, getTotal);
  const fair = bigger === 0 || Math.abs(diff) / bigger <= 0.05;
  const share = giveTotal + getTotal ? getTotal / (giveTotal + getTotal) : 0.5;

  return (
    <>
      <div className="mb-4">
        <h1 className="text-2xl font-semibold tracking-tight">Trade helper</h1>
        <p className="mt-1 max-w-3xl text-sm text-ink-400">
          Put in both sides with each card's printing and condition (or grade) and see if it's fair at today's market
          prices. Record it to move the cards in and out of your collection.
        </p>
      </div>

      <div className="sticky top-14 z-20 mb-4 rounded-xl border border-ink-800 bg-ink-900/95 p-3 backdrop-blur">
        <div className="flex items-center justify-between text-xs">
          <span>
            You give <strong className="tnum text-ink-100">{usd(giveTotal)}</strong>
          </span>
          <span className={`font-semibold ${give.length && get.length ? (fair ? "text-good" : diff > 0 ? "text-good" : "text-rose-300") : "text-ink-500"}`}>
            {!give.length || !get.length
              ? "Add cards to both sides"
              : fair
                ? "Fair trade (within 5%)"
                : diff > 0
                  ? `You're up ${usd(diff)}`
                  : `You're down ${usd(-diff)}`}
          </span>
          <span>
            You get <strong className="tnum text-ink-100">{usd(getTotal)}</strong>
          </span>
        </div>
        <div className="mt-2 flex h-2 overflow-hidden rounded-full bg-ink-800" aria-hidden>
          <div className="bg-rose-400/70" style={{ width: `${(1 - share) * 100}%` }} />
          <div className="bg-good/80" style={{ width: `${share * 100}%` }} />
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Side title="You give" side="give" lines={give} setLines={setGive} defaultCondition={loaderData.defaultCondition} region={loaderData.region} />
        <Side title="You get" side="get" lines={get} setLines={setGet} defaultCondition={loaderData.defaultCondition} region={loaderData.region} />
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-3">
        <record.Form method="post">
          <input type="hidden" name="intent" value="record" />
          <input type="hidden" name="trade" value={JSON.stringify({ give, get })} />
          <button
            disabled={!give.length && !get.length}
            onClick={(e) => {
              if (!confirm("Record this trade? Cards you give from your collection come out of it; cards you get are added.")) e.preventDefault();
            }}
            className="rounded-md bg-accent px-4 py-2 text-sm font-semibold text-black disabled:opacity-40"
          >
            Record trade
          </button>
        </record.Form>
        <button onClick={() => (setGive([]), setGet([]))} className="text-xs text-ink-400 underline">
          Clear
        </button>
        {recorded ? (
          <span className="text-xs text-good">
            Recorded: {recorded.out} out, {recorded.in} in.
          </span>
        ) : null}
        {actionData && "error" in actionData ? <span className="text-xs text-rose-300">{actionData.error}</span> : null}
      </div>
      <p className="mt-3 max-w-3xl text-[11px] text-ink-500">
        Values are TCGplayer market for the printing, with typical discounts for played condition. Slabs use PSA sold
        averages when there are comps, otherwise the raw price. Only cards picked from your collection are removed when
        you record a trade.
      </p>
    </>
  );
}

function Side({
  title,
  side,
  lines,
  setLines,
  defaultCondition,
  region,
}: {
  title: string;
  side: "give" | "get";
  lines: Line[];
  setLines: React.Dispatch<React.SetStateAction<Line[]>>;
  defaultCondition: string;
  region: string;
}) {
  const search = useFetcher<typeof loader>();
  const [q, setQ] = useState("");
  const load = search.load;
  useEffect(() => {
    if (q.trim().length < 2) return;
    const t = setTimeout(() => void load(`/trade?${new URLSearchParams({ q, side, region })}`), 250);
    return () => clearTimeout(t);
  }, [q, side, region, load]);

  const results = q.trim().length >= 2 ? (search.data?.results ?? []) : [];
  const add = useCallback(
    (c: TradeCard) => {
      const it = c.item;
      setLines((ls) => [
        ...ls,
        {
          key: `${c.cardId}-${Date.now()}`,
          card: c,
          finish: it?.finish ?? c.finishes[0]?.name ?? "Normal",
          condition: it?.condition ?? defaultCondition,
          grader: it?.grader ?? null,
          grade: it?.grade != null ? String(Number(it.grade)) : "10",
          qty: 1,
        },
      ]);
      setQ("");
    },
    [setLines, defaultCondition],
  );
  const update = (key: string, patch: Partial<Line>) => setLines((ls) => ls.map((l) => (l.key === key ? { ...l, ...patch } : l)));
  const total = lines.reduce((s, l) => s + (lineValue(l) ?? 0), 0);

  return (
    <section className="rounded-xl border border-ink-800 bg-ink-900">
      <header className="flex items-center justify-between border-b border-ink-800 px-3 py-2">
        <h2 className="text-sm font-semibold">{title}</h2>
        <span className="tnum text-sm font-semibold text-accent">{usd(total)}</span>
      </header>
      <div className="relative p-3">
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder={side === "give" ? "Search your cards or any card…" : "Search any card…"}
          className="w-full rounded-md border border-ink-700 bg-ink-850 px-2.5 py-2 text-sm outline-none focus:border-accent"
        />
        {results.length ? (
          <ul className="absolute inset-x-3 top-full z-10 max-h-80 overflow-y-auto rounded-lg border border-ink-700 bg-ink-850 shadow-xl">
            {results.map((c, i) => (
              <li key={`${c.cardId}-${c.item?.id ?? i}`}>
                <button onClick={() => add(c)} className="flex w-full items-center gap-2 px-2.5 py-1.5 text-left text-xs hover:bg-ink-800">
                  {c.image ? <img src={c.image} alt="" className="h-9 w-auto rounded-sm" /> : null}
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-ink-100">{c.name}</span>
                    <span className="block truncate text-[10px] text-ink-500">
                      {c.setName} · {c.localId}
                    </span>
                  </span>
                  {c.item ? <span className="shrink-0 rounded bg-good/15 px-1.5 py-0.5 text-[10px] text-good">yours ×{c.item.quantity}</span> : null}
                </button>
              </li>
            ))}
          </ul>
        ) : null}
      </div>
      {lines.length === 0 ? (
        <p className="px-3 pb-4 text-xs text-ink-500">{side === "give" ? "Cards you're handing over." : "Cards you're getting."}</p>
      ) : (
        <ul className="divide-y divide-ink-850">
          {lines.map((l) => (
            <li key={l.key} className="flex gap-3 px-3 py-2.5">
              {l.card.image ? <img src={l.card.image} alt="" className="h-20 w-auto shrink-0 rounded-sm ring-1 ring-ink-700" /> : null}
              <div className="min-w-0 flex-1 space-y-1.5">
                <div className="flex items-start gap-2">
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-medium">{l.card.name}</div>
                    <div className="truncate text-[11px] text-ink-500">
                      {l.card.setName} · {l.card.localId}
                      {l.card.item ? " · from your collection" : ""}
                    </div>
                  </div>
                  <span className="tnum shrink-0 text-sm font-semibold text-accent">{usd(lineValue(l))}</span>
                  <button onClick={() => setLines((ls) => ls.filter((x) => x.key !== l.key))} aria-label="Remove" className="text-ink-500 hover:text-rose-300">
                    ✕
                  </button>
                </div>
                <div className="flex flex-wrap items-center gap-1.5">
                  {l.card.item ? (
                    <span className="rounded border border-ink-700 px-1.5 py-0.5 text-[11px] text-ink-300">{finishShort(l.finish)}</span>
                  ) : (
                    <select value={l.finish} onChange={(e) => update(l.key, { finish: e.target.value })} className="rounded-md border border-ink-700 bg-ink-850 px-1.5 py-1 text-[11px]">
                      {l.card.finishes.map((f) => (
                        <option key={f.name} value={f.name}>
                          {finishShort(f.name)}
                        </option>
                      ))}
                    </select>
                  )}
                  <button
                    onClick={() => update(l.key, { grader: l.grader ? null : "PSA" })}
                    className={`rounded-md border px-1.5 py-1 text-[11px] ${l.grader ? "border-accent text-accent" : "border-ink-700 text-ink-400"}`}
                  >
                    {l.grader ? "Graded" : "Raw"}
                  </button>
                  {l.grader ? (
                    <>
                      <select value={l.grader} onChange={(e) => update(l.key, { grader: e.target.value })} className="rounded-md border border-ink-700 bg-ink-850 px-1.5 py-1 text-[11px]">
                        {GRADERS.map((g) => (
                          <option key={g}>{g}</option>
                        ))}
                      </select>
                      <select value={l.grade} onChange={(e) => update(l.key, { grade: e.target.value })} className="rounded-md border border-ink-700 bg-ink-850 px-1.5 py-1 text-[11px]">
                        {GRADES.map((g) => (
                          <option key={g} value={String(g)}>
                            {g}
                          </option>
                        ))}
                      </select>
                    </>
                  ) : (
                    CONDITIONS.map((c) => (
                      <button
                        key={c.code}
                        title={c.label}
                        onClick={() => update(l.key, { condition: c.code })}
                        className={`rounded-md border px-1.5 py-1 text-[11px] font-semibold ${
                          l.condition === c.code ? "border-accent bg-accent/15 text-accent" : "border-ink-700 text-ink-400"
                        }`}
                      >
                        {c.short}
                      </button>
                    ))
                  )}
                  <span className="ml-auto flex items-center gap-1 text-[11px]">
                    <button onClick={() => update(l.key, { qty: Math.max(1, l.qty - 1) })} className="h-6 w-6 rounded border border-ink-700">
                      −
                    </button>
                    <span className="tnum w-5 text-center">{l.qty}</span>
                    <button
                      onClick={() => update(l.key, { qty: Math.min(l.card.item?.quantity ?? 99, l.qty + 1) })}
                      className="h-6 w-6 rounded border border-ink-700"
                    >
                      +
                    </button>
                  </span>
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
