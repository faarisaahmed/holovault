import { Form } from "react-router";
import type { Route } from "./+types/set-detail";
import { Checklist, ProgressBar } from "@/components/checklist";
import { Toggle } from "@/components/controls";
import { Breadcrumbs } from "@/components/ui";
import { usd } from "@/lib/format";
import { progress } from "@/lib/progress";
import { requireUser } from "@/lib/server/auth.server";
import { handleCardAction } from "@/lib/server/card-actions.server";
import { cardsInSet, getSetSummary } from "@/lib/server/catalog.server";
import { getSettings, ownedCounts } from "@/lib/server/collection.server";
import { getUserDb } from "@/lib/server/db.server";
import { progressCards, setGoal } from "@/lib/server/progress.server";
import { goal } from "@/lib/server/schema";
import { and, eq } from "drizzle-orm";

export const meta: Route.MetaFunction = ({ loaderData }) => [
  { title: `${loaderData?.set.name ?? "Set"} — Holovault` },
];

export async function loader({ request, params }: Route.LoaderArgs) {
  const user = await requireUser(request);
  const set = getSetSummary(decodeURIComponent(params.setId));
  if (!set) throw new Response("Set not found", { status: 404 });
  const sp = new URL(request.url).searchParams;
  const master = sp.get("view") === "master";
  const show = sp.get("show") ?? "all";

  const cards = cardsInSet(set.id);
  const pcs = progressCards(cards);
  const owned = await ownedCounts(user.id, cards.map((c) => c.id));
  const byId = new Map(pcs.map((p) => [p.id, p]));
  const db = await getUserDb();
  const tracked = (
    await db.select().from(goal).where(and(eq(goal.userId, user.id), eq(goal.kind, "set"), eq(goal.target, set.id)))
  ).length > 0;

  const list = cards
    .map((c) => {
      const p = byId.get(c.id)!;
      return {
        id: c.id,
        name: c.name,
        localId: c.localId,
        image: c.image,
        finishes: p.finishes.map((f) => ({ name: f, price: p.prices[f] ?? null, owned: owned.get(c.id)?.get(f) ?? 0 })),
      };
    })
    .filter((c) => {
      const have = master ? c.finishes.every((f) => f.owned > 0) : c.finishes.some((f) => f.owned > 0);
      return show === "all" || (show === "missing" ? !have : have);
    });

  return {
    set,
    master,
    show,
    tracked,
    cards: list,
    base: progress(pcs, owned, false),
    full: progress(pcs, owned, true),
    defaultCondition: (await getSettings(user.id)).defaultCondition,
  };
}

export async function action({ request, params }: Route.ActionArgs) {
  const user = await requireUser(request);
  const form = await request.formData();
  if (form.get("intent") === "track") {
    await setGoal(user.id, "set", decodeURIComponent(params.setId), form.get("on") === "1");
    return { ok: true };
  }
  return (await handleCardAction(user.id, form)) ?? { error: "Unknown request." };
}

export default function SetDetail({ loaderData }: Route.ComponentProps) {
  const { set, master, show, tracked, cards, base, full, defaultCondition } = loaderData;
  const cur = master ? full : base;
  return (
    <>
      <Breadcrumbs items={[{ href: "/sets", label: "Sets" }, { label: set.name }]} />
      <div className="mb-4 flex flex-wrap items-center gap-4">
        {set.logo ? <img src={set.logo} alt="" className="h-14 w-auto max-w-40 object-contain" /> : null}
        <div className="min-w-0 flex-1">
          <h1 className="text-2xl font-semibold tracking-tight">{set.name}</h1>
          <p className="text-xs text-ink-400">
            {set.releaseDate} · {set.cardCount} cards
          </p>
        </div>
        <Form method="post">
          <input type="hidden" name="intent" value="track" />
          <input type="hidden" name="on" value={tracked ? "0" : "1"} />
          <button className="rounded-md border border-ink-700 px-3 py-1.5 text-xs hover:border-accent">
            {tracked ? "★ Tracking" : "☆ Track this set"}
          </button>
        </Form>
      </div>

      <div className="mb-4 grid gap-3 sm:grid-cols-2">
        {[
          { label: "Set", p: base, tone: "bg-good" },
          { label: "Master set (every printing)", p: full, tone: "bg-accent" },
        ].map(({ label, p, tone }) => (
          <div key={label} className="rounded-lg border border-ink-800 bg-ink-900 px-3 py-2">
            <div className="flex justify-between text-xs">
              <span className="text-ink-300">{label}</span>
              <span className="tnum font-semibold">
                {p.have}/{p.total} · {Math.round(p.pct * 100)}%
              </span>
            </div>
            <div className="my-1.5">
              <ProgressBar pct={p.pct} tone={tone} />
            </div>
            <div className="text-[11px] text-ink-500">
              {p.have === p.total
                ? "Complete!"
                : `${usd(p.costToComplete)} at market to finish${p.unpricedMissing ? ` (+${p.unpricedMissing} unpriced)` : ""}`}
            </div>
          </div>
        ))}
      </div>

      <div className="mb-4 flex flex-wrap items-center gap-2">
        <Toggle
          name="view"
          value={master ? "master" : "set"}
          options={[
            { value: "set", label: "Set" },
            { value: "master", label: "Master set" },
          ]}
        />
        <Toggle
          name="show"
          value={show}
          options={[
            { value: "all", label: "All" },
            { value: "missing", label: "Missing" },
            { value: "owned", label: "Owned" },
          ]}
        />
        <span className="text-xs text-ink-500">
          {cards.length} shown · click a + chip to add that printing in {defaultCondition}
        </span>
      </div>

      {cards.length === 0 ? (
        <p className="rounded-xl border border-ink-800 bg-ink-900 px-4 py-14 text-center text-sm text-ink-400">
          {show === "missing" ? `Nothing missing — ${cur === full ? "master set" : "set"} complete!` : "Nothing to show."}
        </p>
      ) : (
        <Checklist cards={cards} master={master} defaultCondition={defaultCondition} />
      )}
    </>
  );
}
