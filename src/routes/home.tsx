import { Link } from "react-router";
import type { Route } from "./+types/home";
import { CopyBadge, finishShort } from "@/components/finish";
import { usd } from "@/lib/format";
import { getSessionUser } from "@/lib/server/auth.server";
import { getSettings, totals, valuedCollection } from "@/lib/server/collection.server";
import { moversFor } from "@/lib/server/prices.server";
import { mySets } from "@/lib/server/progress.server";
import { wishlist } from "@/lib/server/wishlist.server";

export async function loader({ request }: Route.LoaderArgs) {
  const user = await getSessionUser(request);
  if (!user) return { signedIn: false as const };
  const items = await valuedCollection(user.id);
  const t = totals(items);
  const settings = await getSettings(user.id);
  const gradingCost = (settings.gradingFeeCents + settings.gradingShippingCents) / 100;

  const top = [...items]
    .filter((i) => i.unitValue != null)
    .sort((a, b) => b.unitValue! - a.unitValue!)
    .slice(0, 8);
  const bySet = new Map<string, { name: string; value: number; copies: number }>();
  for (const i of items) {
    if (!i.card) continue;
    const s = bySet.get(i.card.setId) ?? { name: i.card.setName, value: 0, copies: 0 };
    s.value += (i.unitValue ?? 0) * i.quantity;
    s.copies += i.quantity;
    bySet.set(i.card.setId, s);
  }
  // A set you own one card of isn't "close"; only show real progress.
  const sets = (await mySets(user.id))
    .filter((s) => s.base.pct >= 0.05)
    .sort((a, b) => b.base.pct - a.base.pct)
    .slice(0, 4);
  const gradeable = items.filter(
    (i) => !i.grader && (i.condition === "M" || i.condition === "NM") && (i.marketNm ?? 0) >= gradingCost,
  ).length;

  const moves = await moversFor(items);
  const lean = (m: NonNullable<typeof moves>["up"][number]) => ({
    id: m.item.id,
    name: m.item.card?.name ?? m.item.cardId,
    set: m.item.card?.setName ?? "",
    image: m.item.card?.image ?? null,
    now: m.now,
    change: m.change,
    delta: m.delta,
  });
  const wishes = await wishlist(user.id);

  return {
    signedIn: true as const,
    name: user.name,
    movers: moves ? { days: moves.days, total: moves.total, up: moves.up.map(lean), down: moves.down.map(lean) } : null,
    wishFlags: wishes.filter((w) => w.flag).map((w) => ({ id: w.id, name: w.card.name, price: w.price, flag: w.flag })),
    totals: t,
    top,
    bySet: [...bySet.entries()].map(([id, s]) => ({ id, ...s })).sort((a, b) => b.value - a.value).slice(0, 8),
    sets,
    recent: items.slice(0, 6),
    gradeable,
  };
}

export default function Home({ loaderData }: Route.ComponentProps) {
  if (!loaderData.signedIn) return <Landing />;
  const { name, totals: t, top, bySet, sets, recent, gradeable, movers, wishFlags } = loaderData;
  const gain = t.costKnown ? t.value - t.cost : null;
  const maxSet = bySet[0]?.value || 1;

  if (t.copies === 0) {
    return (
      <div className="mx-auto max-w-xl py-16 text-center">
        <h1 className="text-2xl font-semibold tracking-tight">Welcome, {name.split(" ")[0]}</h1>
        <p className="mt-2 text-sm text-ink-400">Your collection is empty. A few ways to start:</p>
        <div className="mt-6 flex flex-wrap justify-center gap-3">
          <Link to="/add" className="rounded-md bg-accent px-4 py-2 text-sm font-semibold text-black">
            Add cards
          </Link>
          <Link to="/add/scan" className="rounded-md border border-ink-700 px-4 py-2 text-sm text-ink-200 hover:border-accent">
            Scan with your camera
          </Link>
          <Link to="/import" className="rounded-md border border-ink-700 px-4 py-2 text-sm text-ink-200 hover:border-accent">
            Import a spreadsheet
          </Link>
        </div>
      </div>
    );
  }

  return (
    <>
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <h1 className="text-2xl font-semibold tracking-tight">Your collection</h1>
        <div className="ml-auto flex gap-2 text-xs">
          <Link to="/add/scan" className="rounded-md border border-ink-700 px-3 py-1.5 text-ink-200 hover:border-accent">
            Scan cards
          </Link>
          <Link to="/add" className="rounded-md bg-accent px-3 py-1.5 font-semibold text-black">
            Add cards
          </Link>
        </div>
      </div>
      <div className="mb-6 grid grid-cols-2 gap-2 sm:grid-cols-4">
        <Tile label="Value" value={usd(t.value)} sub={t.unpriced ? `${t.unpriced} unpriced` : "market, today"} accent />
        <Tile label="Cards" value={t.copies.toLocaleString()} sub={`${t.unique.toLocaleString()} different`} />
        <Tile
          label="Gain"
          value={gain == null ? "—" : `${gain >= 0 ? "+" : "−"}${usd(Math.abs(gain))}`}
          sub={t.costKnown ? `on ${t.costKnown} copies with a price paid` : "add what you paid to see it"}
          tone={gain == null ? undefined : gain >= 0 ? "text-good" : "text-rose-400"}
        />
        <Link to="/grading" className="block">
          <Tile label="Worth a look for grading" value={String(gradeable)} sub="Mint / NM cards worth more than grading costs" />
        </Link>
      </div>

      <div className="grid gap-6 lg:grid-cols-[1fr_360px]">
        <section>
          <h2 className="mb-2 text-sm font-semibold text-ink-200">Most valuable</h2>
          <div className="grid grid-cols-4 gap-2 sm:gap-3">
            {top.map((i) => (
              <div key={i.id} className="flex flex-col">
                {i.card?.image ? (
                  <img src={i.card.image} alt={i.card.name} loading="lazy" className="aspect-[245/342] w-full rounded-lg object-cover ring-1 ring-ink-800" />
                ) : null}
                <div className="mt-1 flex items-center gap-1.5">
                  <span className="hidden truncate text-[11px] text-ink-300 sm:inline">{i.card?.name}</span>
                  <span className="text-xs font-semibold text-accent sm:ml-auto">{usd(i.unitValue, { compact: true })}</span>
                </div>
                <div className="hidden items-center gap-1 text-[10px] text-ink-500 sm:flex">
                  {finishShort(i.finish)} <CopyBadge {...i} />
                </div>
              </div>
            ))}
          </div>

          <h2 className="mb-2 mt-6 text-sm font-semibold text-ink-200">Recently added</h2>
          <ul className="divide-y divide-ink-850 rounded-xl border border-ink-800 bg-ink-900">
            {recent.map((i) => (
              <li key={i.id} className="flex items-center gap-3 px-3 py-2 text-sm">
                {i.card?.image ? <img src={i.card.image} alt="" className="h-10 w-auto rounded-sm" /> : null}
                <span className="min-w-0 flex-1 truncate">
                  {i.card?.name} <span className="text-ink-500">· {i.card?.setName}</span>
                </span>
                <span className="hidden text-[11px] text-ink-400 sm:inline">{finishShort(i.finish)}</span>
                <CopyBadge {...i} />
                <span className="w-16 text-right text-xs">{usd(i.unitValue)}</span>
              </li>
            ))}
          </ul>
        </section>

        <aside className="space-y-6">
          {wishFlags.length ? (
            <Link to="/wishlist" className="block rounded-xl border border-good/30 bg-good/10 px-3 py-2.5 text-xs hover:border-good">
              <div className="font-semibold text-good">
                ♥ {wishFlags.length} wishlist {wishFlags.length === 1 ? "card is" : "cards are"} worth a look
              </div>
              <div className="mt-0.5 truncate text-ink-300">{wishFlags.map((w) => w.name).join(", ")}</div>
            </Link>
          ) : null}
          <Movers movers={movers} />
          <section>
            <h2 className="mb-2 text-sm font-semibold text-ink-200">Value by set</h2>
            <ul className="space-y-1.5">
              {bySet.map((s) => (
                <li key={s.id}>
                  <Link to={`/sets/${encodeURIComponent(s.id)}`} className="block text-xs hover:text-accent">
                    <div className="flex justify-between">
                      <span className="truncate">{s.name}</span>
                      <span className="tnum">{usd(s.value)}</span>
                    </div>
                    <div className="mt-0.5 h-1.5 rounded bg-ink-800">
                      <div className="h-1.5 rounded bg-accent" style={{ width: `${(s.value / maxSet) * 100}%` }} />
                    </div>
                  </Link>
                </li>
              ))}
            </ul>
          </section>
          <section>
            <h2 className="mb-2 text-sm font-semibold text-ink-200">Closest to complete</h2>
            {sets.length === 0 ? (
              <p className="text-xs text-ink-500">
                No set is past 5% yet. Open any set from{" "}
                <Link to="/sets" className="underline hover:text-accent">
                  Sets
                </Link>{" "}
                to see what's missing.
              </p>
            ) : null}
            <ul className="space-y-2">
              {sets.map((s) => (
                <li key={s.set.id}>
                  <Link to={`/sets/${encodeURIComponent(s.set.id)}`} className="block text-xs hover:text-accent">
                    <div className="flex justify-between">
                      <span className="truncate">{s.set.name}</span>
                      <span className="tnum">
                        {s.base.have}/{s.base.total} · {Math.round(s.base.pct * 100)}%
                      </span>
                    </div>
                    <div className="mt-0.5 h-1.5 rounded bg-ink-800">
                      <div className="h-1.5 rounded bg-good" style={{ width: `${s.base.pct * 100}%` }} />
                    </div>
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        </aside>
      </div>
    </>
  );
}

function Movers({
  movers,
}: {
  movers: {
    days: number;
    total: number;
    up: { id: string; name: string; set: string; image: string | null; now: number; change: number; delta: number }[];
    down: { id: string; name: string; set: string; image: string | null; now: number; change: number; delta: number }[];
  } | null;
}) {
  if (!movers) return null;
  const row = (m: (typeof movers.up)[number]) => (
    <li key={m.id} className="flex items-center gap-2 text-xs">
      {m.image ? <img src={m.image} alt="" loading="lazy" className="h-8 w-auto rounded-sm" /> : null}
      <span className="min-w-0 flex-1">
        <span className="block truncate text-ink-200">{m.name}</span>
        <span className="block truncate text-[10px] text-ink-500">{m.set}</span>
      </span>
      <span className="tnum shrink-0 text-right">
        <span className={`block font-semibold ${m.change >= 0 ? "text-good" : "text-rose-400"}`}>
          {m.change >= 0 ? "↑" : "↓"} {Math.abs(m.change * 100).toFixed(0)}%
        </span>
        <span className="block text-[10px] text-ink-500">{usd(m.now)}</span>
      </span>
    </li>
  );
  return (
    <section>
      <h2 className="mb-2 flex items-baseline gap-2 text-sm font-semibold text-ink-200">
        {movers.days >= 7 ? "This week" : "Price moves"}
        {movers.days > 0 ? (
          <span className={`tnum text-xs font-normal ${movers.total >= 0 ? "text-good" : "text-rose-400"}`}>
            {movers.total >= 0 ? "+" : "−"}
            {usd(Math.abs(movers.total))} {movers.days < 7 ? `over ${movers.days} day${movers.days === 1 ? "" : "s"}` : ""}
          </span>
        ) : null}
      </h2>
      {movers.days === 0 ? (
        <p className="text-xs text-ink-500">Tracking your cards' prices from today. Risers and fallers show up after the next daily update.</p>
      ) : !movers.up.length && !movers.down.length ? (
        <p className="text-xs text-ink-500">Nothing moved more than 3% in the last {movers.days} days.</p>
      ) : (
        <ul className="space-y-2">
          {movers.up.slice(0, 3).map(row)}
          {movers.down.slice(0, 3).map(row)}
        </ul>
      )}
    </section>
  );
}

function Tile({ label, value, sub, accent, tone }: { label: string; value: string; sub?: string; accent?: boolean; tone?: string }) {
  return (
    <div className="h-full rounded-lg border border-ink-800 bg-ink-900 px-3 py-2">
      <div className="text-[10px] uppercase tracking-wider text-ink-500">{label}</div>
      <div className={`tnum text-lg font-semibold ${tone ?? (accent ? "text-accent" : "text-ink-100")}`}>{value}</div>
      {sub ? <div className="text-[10px] text-ink-500">{sub}</div> : null}
    </div>
  );
}

function Landing() {
  const features = [
    ["Every printing, every condition", "Holo, reverse holo, 1st Edition; Mint through Damaged; PSA, BGS, CGC slabs with grades and cert numbers."],
    ["What it's worth, today", "Market prices refresh daily. See your total, your gain on what you paid, and value by set."],
    ["Worth grading?", "Flags Mint and Near Mint cards whose PSA 9 sells for more than the card plus grading costs."],
    ["Master sets & Pokémon", "Track any set to 100% — just the cards, or every printing — and see what's left and what it costs."],
    ["Plan your binders", "Lay cards out in 3×3 or 4×4 pages by Pokédex number, set or value. One per Pokémon, no rares — your rules."],
    ["Yours, privately", "Sign in with Google or email. No ads, no analytics. Export or delete everything whenever you like."],
  ];
  return (
    <div className="mx-auto max-w-4xl py-10">
      <p className="text-xs font-semibold uppercase tracking-[0.2em] text-accent">Shadowless</p>
      <h1 className="mt-2 text-3xl font-semibold tracking-tight sm:text-4xl">Know what your collection is worth.</h1>
      <p className="mt-3 max-w-2xl text-ink-400">
        Add cards in a couple of clicks, keep printings and conditions straight, and let it tell you what's worth
        grading, how close you are to that master set, and how to lay out your binder.
      </p>
      <div className="mt-6 flex gap-3">
        <Link to="/login?mode=up" className="rounded-md bg-accent px-4 py-2 text-sm font-semibold text-black">
          Create a free account
        </Link>
        <Link to="/login" className="rounded-md border border-ink-700 px-4 py-2 text-sm text-ink-200 hover:border-accent">
          Sign in
        </Link>
      </div>
      <div className="mt-10 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {features.map(([t, d]) => (
          <div key={t} className="rounded-xl border border-ink-800 bg-ink-900 p-4">
            <div className="font-semibold">{t}</div>
            <p className="mt-1 text-sm text-ink-400">{d}</p>
          </div>
        ))}
      </div>
    </div>
  );
}
