import { useState } from "react";
import { Link, useFetcher } from "react-router";
import type { Route } from "./+types/sealed-add";
import { ChipRow, SearchBox, Toggle } from "@/components/controls";
import { SealedIntro } from "@/components/sealed-ui";
import { usd } from "@/lib/format";
import { CATEGORY_LABELS } from "@/lib/sealed";
import { requireUser } from "@/lib/server/auth.server";
import { getSettings } from "@/lib/server/collection.server";
import {
  addLot,
  lotInput,
  myProductIds,
  searchSealed,
  sealedEnabled,
  setWatch,
} from "@/lib/server/sealed.server";

export const meta: Route.MetaFunction = () => [{ title: "Add sealed product — Shadowless" }];

export async function loader({ request }: Route.LoaderArgs) {
  const user = await requireUser(request);
  if (!(await sealedEnabled(user.id))) return { enabled: false as const };
  const sp = new URL(request.url).searchParams;
  const settings = await getSettings(user.id);
  const q = sp.get("q") ?? "";
  const region = sp.get("region") === "ja" ? "ja" : sp.get("region") === "en" ? "en" : settings.defaultRegion;
  const category = sp.get("category") && CATEGORY_LABELS[sp.get("category")!] ? sp.get("category")! : null;
  const results = searchSealed(q, region, category, 60);
  const mine = await myProductIds(user.id);
  return {
    enabled: true as const,
    q,
    region,
    category: category ?? "all",
    results: results.map((r) => ({ ...r, owned: mine.bought.get(r.productId) ?? 0, watched: mine.watched.has(r.productId) })),
  };
}

export async function action({ request }: Route.ActionArgs) {
  const user = await requireUser(request);
  const form = await request.formData();
  const intent = String(form.get("intent"));
  if (intent === "watch") {
    await setWatch(user.id, Number(form.get("productId")), form.get("on") === "1");
    return { ok: true };
  }
  if (intent === "buy") {
    const parsed = lotInput.safeParse(Object.fromEntries(form));
    if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Check the form.", productId: Number(form.get("productId")) };
    await addLot(user.id, parsed.data);
    return { ok: true, added: parsed.data.productId };
  }
  return { error: "Unknown request." };
}

export default function AddSealed({ loaderData: d }: Route.ComponentProps) {
  if (!d.enabled) return <SealedIntro />;
  return (
    <>
      <div className="mb-4">
        <h1 className="text-2xl font-semibold tracking-tight">Add sealed product</h1>
        <p className="mt-1 text-sm text-ink-400">
          Search every booster box, ETB, bundle, tin, blister, collection, case and display. Log a purchase, or watch a
          product for a good time to buy.
        </p>
      </div>
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <SearchBox name="q" placeholder="e.g. evolving skies booster box" value={d.q} />
        <Toggle name="region" value={d.region} options={[{ value: "en", label: "English" }, { value: "ja", label: "Japanese" }]} />
      </div>
      <div className="mb-5">
        <ChipRow
          name="category"
          value={d.category}
          allLabel="Everything"
          options={Object.entries(CATEGORY_LABELS).map(([value, label]) => ({ value, label }))}
        />
      </div>
      {!d.q && d.category === "all" ? (
        <p className="rounded-xl border border-dashed border-ink-700 px-4 py-14 text-center text-sm text-ink-400">
          Search by product or set name, or pick a category.
        </p>
      ) : d.results.length === 0 ? (
        <p className="rounded-xl border border-ink-800 bg-ink-900 px-4 py-14 text-center text-sm text-ink-400">Nothing matches.</p>
      ) : (
        <ul className="divide-y divide-ink-850 rounded-xl border border-ink-800 bg-ink-900">
          {d.results.map((r) => (
            <ResultRow key={r.productId} r={r} />
          ))}
        </ul>
      )}
    </>
  );
}

type Row = Extract<Route.ComponentProps["loaderData"], { enabled: true }>["results"][number];

function ResultRow({ r }: { r: Row }) {
  const [open, setOpen] = useState(false);
  const buy = useFetcher<{ ok?: boolean; error?: string }>();
  const watch = useFetcher();
  const watched = watch.formData ? watch.formData.get("on") === "1" : r.watched;
  const field = "rounded-md border border-ink-700 bg-ink-850 px-2 py-1 text-xs";
  const done = buy.state === "idle" && buy.data?.ok;
  return (
    <li className="px-3 py-2.5">
      <div className="flex flex-wrap items-center gap-3">
        {r.image ? <img src={r.image} alt="" loading="lazy" className="h-12 w-12 shrink-0 rounded object-contain" /> : <span className="h-12 w-12" />}
        <Link to={`/sealed/${r.productId}`} className="min-w-0 flex-1 hover:text-accent">
          <span className="block truncate text-sm font-medium">{r.name}</span>
          <span className="block truncate text-[11px] text-ink-500">
            {CATEGORY_LABELS[r.category] ?? r.category} · {r.setName} · {r.releaseDate?.slice(0, 4)}
            {r.owned ? <span className="text-good"> · you've bought {r.owned}</span> : null}
          </span>
        </Link>
        <span className="tnum w-20 text-right text-sm font-semibold">{usd(r.market)}</span>
        <watch.Form method="post">
          <input type="hidden" name="intent" value="watch" />
          <input type="hidden" name="productId" value={r.productId} />
          <input type="hidden" name="on" value={watched ? "0" : "1"} />
          <button className={`rounded-md border px-2.5 py-1 text-xs ${watched ? "border-accent text-accent" : "border-ink-700 text-ink-300 hover:border-ink-500"}`}>
            {watched ? "★ Watching" : "☆ Watch"}
          </button>
        </watch.Form>
        <button onClick={() => setOpen((o) => !o)} className="rounded-md bg-accent px-2.5 py-1 text-xs font-semibold text-black">
          {open ? "Close" : "Log purchase"}
        </button>
      </div>
      {open ? (
        <buy.Form method="post" className="mt-3 flex flex-wrap items-end gap-3 rounded-lg bg-ink-850 p-3" onSubmit={() => undefined}>
          <input type="hidden" name="intent" value="buy" />
          <input type="hidden" name="productId" value={r.productId} />
          <label className="text-[10px] uppercase tracking-wider text-ink-500">
            Quantity
            <input name="quantity" type="number" min={1} max={10000} defaultValue={1} className={`${field} mt-1 block w-20`} />
          </label>
          <label className="text-[10px] uppercase tracking-wider text-ink-500">
            Paid each ($)
            <input name="unitCost" inputMode="decimal" required defaultValue={r.market != null ? r.market.toFixed(2) : ""} className={`${field} mt-1 block w-28`} />
          </label>
          <label className="text-[10px] uppercase tracking-wider text-ink-500">
            Bought on
            <input name="boughtOn" type="date" defaultValue={new Date().toISOString().slice(0, 10)} className={`${field} mt-1 block`} />
          </label>
          <label className="flex-1 text-[10px] uppercase tracking-wider text-ink-500">
            Notes
            <input name="notes" maxLength={300} placeholder="Where from, receipt #…" className={`${field} mt-1 block w-full`} />
          </label>
          <button disabled={buy.state !== "idle"} className="rounded-md bg-accent px-3 py-1.5 text-xs font-semibold text-black">
            Save purchase
          </button>
          {buy.data?.error ? <span className="w-full text-xs text-rose-300">{buy.data.error}</span> : null}
          {done ? (
            <span className="w-full text-xs text-good">
              Saved.{" "}
              <Link to={`/sealed/${r.productId}`} className="underline">
                See it
              </Link>
            </span>
          ) : null}
        </buy.Form>
      ) : null}
    </li>
  );
}
