import { Link } from "react-router";
import type { Route } from "./+types/home";
import { CopyBadge, finishShort } from "@/components/finish";
import { usd } from "@/lib/format";
import { getSessionUser } from "@/lib/server/auth.server";
import { getSettings, totals, valuedCollection } from "@/lib/server/collection.server";
import { mySets } from "@/lib/server/progress.server";

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
  const sets = (await mySets(user.id)).sort((a, b) => b.base.pct - a.base.pct).slice(0, 4);
  const gradeable = items.filter(
    (i) => !i.grader && (i.condition === "M" || i.condition === "NM") && (i.marketNm ?? 0) >= gradingCost,
  ).length;

  return {
    signedIn: true as const,
    name: user.name,
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
  const { name, totals: t, top, bySet, sets, recent, gradeable } = loaderData;
  const gain = t.costKnown ? t.value - t.cost : null;
  const maxSet = bySet[0]?.value || 1;

  if (t.copies === 0) {
    return (
      <div className="mx-auto max-w-xl py-16 text-center">
        <h1 className="text-2xl font-semibold tracking-tight">Welcome, {name.split(" ")[0]}</h1>
        <p className="mt-2 text-sm text-ink-400">Your collection is empty. Two ways to start:</p>
        <div className="mt-6 flex justify-center gap-3">
          <Link to="/add" className="rounded-md bg-accent px-4 py-2 text-sm font-semibold text-black">
            Add cards
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
      <h1 className="mb-4 text-2xl font-semibold tracking-tight">Your collection</h1>
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
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            {top.map((i) => (
              <div key={i.id} className="flex flex-col">
                {i.card?.image ? (
                  <img src={i.card.image} alt={i.card.name} loading="lazy" className="aspect-[245/342] w-full rounded-lg object-cover ring-1 ring-ink-800" />
                ) : null}
                <div className="mt-1 flex items-center gap-1.5">
                  <span className="truncate text-[11px] text-ink-300">{i.card?.name}</span>
                  <span className="ml-auto text-xs font-semibold text-accent">{usd(i.unitValue, { compact: true })}</span>
                </div>
                <div className="flex items-center gap-1 text-[10px] text-ink-500">
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
                <span className="text-[11px] text-ink-400">{finishShort(i.finish)}</span>
                <CopyBadge {...i} />
                <span className="w-16 text-right text-xs">{usd(i.unitValue)}</span>
              </li>
            ))}
          </ul>
        </section>

        <aside className="space-y-6">
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
      <p className="text-xs font-semibold uppercase tracking-[0.2em] text-accent">Holovault</p>
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
