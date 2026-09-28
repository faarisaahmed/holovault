import { useState } from "react";
import { Form, Link, redirect, useSearchParams } from "react-router";
import type { Route } from "./+types/binder-detail";
import { BinderForm } from "@/components/binder-form";
import { ProgressBar } from "@/components/checklist";
import { Breadcrumbs } from "@/components/ui";
import { usd } from "@/lib/format";
import { paginate, planSlots, type Slot } from "@/lib/binder";
import { requireUser } from "@/lib/server/auth.server";
import { binderCandidates, binderInput, deleteBinder, getBinder, toRecord, updateBinder } from "@/lib/server/binder.server";
import { listSets, listSpecies } from "@/lib/server/catalog.server";

export const meta: Route.MetaFunction = ({ loaderData }) => [{ title: `${loaderData?.binder.name ?? "Binder"} — Holovault` }];

export async function loader({ request, params }: Route.LoaderArgs) {
  const user = await requireUser(request);
  const b = await getBinder(user.id, params.binderId);
  if (!b) throw new Response("Binder not found", { status: 404 });
  const { cards, species } = await binderCandidates(user.id, b.config);
  const slots = planSlots(cards, b.config, species);
  const perPage = b.rows * b.cols;
  const pages = paginate(slots, perPage, b.config);
  const spreads = Math.max(1, Math.ceil(pages.length / 2));
  const spread = Math.min(spreads, Math.max(1, Number(new URL(request.url).searchParams.get("spread")) || 1));
  const owned = slots.filter((s) => s.owned).length;
  const missingCost = slots.filter((s) => !s.owned && s.card?.price != null).reduce((t, s) => t + s.card!.price!, 0);
  return {
    binder: { id: b.id, name: b.name, rows: b.rows, cols: b.cols, config: b.config },
    // Only the open spread's pockets go to the browser.
    spreadPages: pages.slice((spread - 1) * 2, spread * 2),
    firstPage: (spread - 1) * 2 + 1,
    spread,
    spreads,
    pageCount: pages.length,
    total: slots.length,
    owned,
    missingCost,
    sets: listSets().map((s) => ({ id: s.id, name: s.name, region: s.region })),
    species: listSpecies(),
  };
}

export async function action({ request, params }: Route.ActionArgs) {
  const user = await requireUser(request);
  const form = await request.formData();
  if (form.get("intent") === "delete") {
    await deleteBinder(user.id, params.binderId);
    throw redirect("/binders");
  }
  const parsed = binderInput.safeParse(Object.fromEntries(form));
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Check the form." };
  await updateBinder(user.id, params.binderId, toRecord(parsed.data));
  return { ok: true };
}

export default function BinderDetail({ loaderData: d, actionData }: Route.ComponentProps) {
  const [editing, setEditing] = useState(false);
  const [params, setParams] = useSearchParams();
  const go = (s: number) => {
    const p = new URLSearchParams(params);
    p.set("spread", String(s));
    setParams(p, { preventScrollReset: true });
  };
  const pct = d.total ? d.owned / d.total : 0;
  return (
    <>
      <Breadcrumbs items={[{ href: "/binders", label: "Binders" }, { label: d.binder.name }]} />
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <h1 className="text-2xl font-semibold tracking-tight">{d.binder.name}</h1>
        <span className="text-xs text-ink-500">
          {d.binder.rows}×{d.binder.cols} · {d.pageCount} pages · {d.total} pockets
        </span>
        <button onClick={() => setEditing((e) => !e)} className="ml-auto rounded-md border border-ink-700 px-3 py-1.5 text-xs hover:border-accent">
          {editing ? "Close settings" : "Binder settings"}
        </button>
      </div>

      {editing ? (
        <div className="mb-5 space-y-2">
          {actionData && "error" in actionData ? <p className="text-sm text-rose-300">{actionData.error}</p> : null}
          <BinderForm initial={d.binder} sets={d.sets} species={d.species} submitLabel="Save binder" />
          <Form method="post" onSubmit={(e) => { if (!confirm("Delete this binder? Your cards stay in your collection.")) e.preventDefault(); }}>
            <input type="hidden" name="intent" value="delete" />
            <button className="text-[11px] text-rose-300 underline">Delete binder</button>
          </Form>
        </div>
      ) : null}

      {d.binder.config.source !== "collection" ? (
        <div className="mb-4 max-w-xl text-xs">
          <div className="flex justify-between">
            <span>
              {d.owned}/{d.total} filled · {Math.round(pct * 100)}%
            </span>
            <span className="text-ink-500">{usd(d.missingCost)} to fill the rest at market</span>
          </div>
          <ProgressBar pct={pct} />
        </div>
      ) : null}

      {d.total === 0 ? (
        <p className="rounded-xl border border-dashed border-ink-700 px-4 py-14 text-center text-sm text-ink-400">
          No cards match this binder's rules yet.{" "}
          <Link to="/add" className="text-accent underline">
            Add some cards
          </Link>{" "}
          or change the settings.
        </p>
      ) : (
        <>
          <div className="grid gap-4 lg:grid-cols-2">
            {d.spreadPages.map((page, i) => (
              <Page key={i} slots={page} rows={d.binder.rows} cols={d.binder.cols} number={d.firstPage + i} />
            ))}
          </div>
          <div className="mt-4 flex items-center justify-center gap-3 text-xs">
            <button disabled={d.spread <= 1} onClick={() => go(d.spread - 1)} className="rounded-md border border-ink-700 px-3 py-1.5 disabled:opacity-30">
              ← Previous
            </button>
            <span className="tnum text-ink-400">
              Pages {d.firstPage}–{Math.min(d.pageCount, d.firstPage + 1)} of {d.pageCount}
            </span>
            <button disabled={d.spread >= d.spreads} onClick={() => go(d.spread + 1)} className="rounded-md border border-ink-700 px-3 py-1.5 disabled:opacity-30">
              Next →
            </button>
          </div>
        </>
      )}
    </>
  );
}

function Page({ slots, rows, cols, number }: { slots: Slot[]; rows: number; cols: number; number: number }) {
  const pockets = Array.from({ length: rows * cols }, (_, i) => slots[i] ?? null);
  return (
    <div className="rounded-xl border border-ink-700 bg-ink-900 p-3 shadow-inner">
      <div className="grid gap-2" style={{ gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))` }}>
        {pockets.map((s, i) => (
          <div key={s?.key ?? `empty-${i}`} className="relative aspect-[245/342] overflow-hidden rounded-md bg-ink-850 ring-1 ring-ink-800" title={s?.card ? `${s.card.name} · ${s.card.setName} ${s.card.localId}` : s?.label}>
            {s?.card?.image ? (
              <img src={s.card.image} alt={s.card.name} loading="lazy" className={`h-full w-full object-cover ${s.owned ? "" : "opacity-25 grayscale"}`} />
            ) : null}
            {s && !s.owned ? (
              <span className="absolute inset-x-0 bottom-0 bg-black/70 px-1 py-0.5 text-center text-[9px] text-ink-200">
                {s.card ? s.card.name : s.label}
              </span>
            ) : null}
          </div>
        ))}
      </div>
      <div className="mt-2 text-center text-[10px] text-ink-500">Page {number}</div>
    </div>
  );
}
