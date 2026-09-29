import { Form, Link } from "react-router";
import type { Route } from "./+types/pokemon";
import { Checklist, ProgressBar } from "@/components/checklist";
import { SearchBox, Toggle } from "@/components/controls";
import { usd } from "@/lib/format";
import { progress } from "@/lib/progress";
import { requireUser } from "@/lib/server/auth.server";
import { handleCardAction } from "@/lib/server/card-actions.server";
import { cardsOfSpecies, listSpecies, type CatalogCard } from "@/lib/server/catalog.server";
import { getSettings, ownedCounts } from "@/lib/server/collection.server";
import { getDb } from "@/lib/db.server";
import { progressCards, setGoal, trackedSpecies } from "@/lib/server/progress.server";
import type { Region } from "@/lib/types";

export const meta: Route.MetaFunction = ({ loaderData }) => [
  { title: `${loaderData?.species?.name ?? "Pokémon"} — Shadowless` },
];

const squash = (s: string) => s.toLowerCase().replace(/[^a-z0-9♀♂]+/g, "");

/** Straight reprints share a print key; keep the first (oldest) of each. */
function dropReprints(cards: CatalogCard[]): CatalogCard[] {
  const keys = new Map<string, string | null>();
  const rows = getDb()
    .prepare(`SELECT id, print_key FROM cards WHERE id IN (${cards.map(() => "?").join(",") || "''"})`)
    .all(...cards.map((c) => c.id)) as { id: string; print_key: string | null }[];
  for (const r of rows) keys.set(r.id, r.print_key);
  const seen = new Set<string>();
  return cards.filter((c) => {
    const k = keys.get(c.id);
    if (!k) return true;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

export async function loader({ request }: Route.LoaderArgs) {
  const user = await requireUser(request);
  const settings = await getSettings(user.id);
  const sp = new URL(request.url).searchParams;
  const q = sp.get("p") ?? "";
  const region = (sp.get("region") ?? settings.defaultRegion) as Region;
  const master = sp.get("view") === "master";
  const noRares = sp.get("rares") === "no";
  const noReprints = sp.get("reprints") === "no";
  const all = listSpecies();
  const species =
    (/^\d+$/.test(q.trim()) ? all.find((s) => s.dexId === Number(q)) : all.find((s) => squash(s.name) === squash(q))) ??
    all.filter((s) => q && squash(s.name).startsWith(squash(q))).sort((a, b) => a.dexId - b.dexId)[0] ??
    null;

  const trackedIds = await trackedSpecies(user.id);
  const owned = await ownedCounts(user.id);
  const tracked = trackedIds.map((d) => {
    const s = all.find((x) => x.dexId === d);
    const p = progress(progressCards(cardsOfSpecies(d, region)), owned, false);
    return { dexId: d, name: s?.name ?? `#${d}`, pct: p.pct, have: p.have, total: p.total };
  });

  if (!species) return { q, region, master, noRares, noReprints, species: null, tracked, names: all.map((s) => s.name) };

  let cards = cardsOfSpecies(species.dexId, region === "ja" ? "ja" : "en");
  if (noRares) cards = cards.filter((c) => c.rarityRank < 50);
  if (noReprints) cards = dropReprints(cards);
  const pcs = progressCards(cards);
  const byId = new Map(pcs.map((p) => [p.id, p]));
  return {
    q,
    region,
    master,
    noRares,
    noReprints,
    species,
    isTracked: trackedIds.includes(species.dexId),
    tracked,
    names: all.map((s) => s.name),
    base: progress(pcs, owned, false),
    full: progress(pcs, owned, true),
    defaultCondition: settings.defaultCondition,
    cards: cards.map((c) => ({
      id: c.id,
      name: c.name,
      localId: c.localId,
      subtitle: `${c.setName} · ${c.releaseDate?.slice(0, 4) ?? ""}`,
      image: c.image,
      finishes: byId.get(c.id)!.finishes.map((f) => ({
        name: f,
        price: byId.get(c.id)!.prices[f] ?? null,
        owned: owned.get(c.id)?.get(f) ?? 0,
      })),
    })),
  };
}

export async function action({ request }: Route.ActionArgs) {
  const user = await requireUser(request);
  const form = await request.formData();
  if (form.get("intent") === "track") {
    await setGoal(user.id, "species", String(form.get("dexId")), form.get("on") === "1");
    return { ok: true };
  }
  return (await handleCardAction(user.id, form)) ?? { error: "Unknown request." };
}

export default function Pokemon({ loaderData: d }: Route.ComponentProps) {
  return (
    <>
      <div className="mb-4">
        <h1 className="text-2xl font-semibold tracking-tight">Pokémon</h1>
        <p className="mt-1 max-w-3xl text-sm text-ink-400">
          Collecting one Pokémon? Pick it to see every card of it — every set and form — and how far through you are.
        </p>
      </div>
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <SearchBox name="p" placeholder="Pokémon name or Pokédex number" value={d.q} list="species" />
        <datalist id="species">
          {d.names.map((n) => (
            <option key={n} value={n} />
          ))}
        </datalist>
        <Toggle name="region" value={d.region} options={[{ value: "en", label: "English" }, { value: "ja", label: "Japanese" }]} />
        <Toggle name="view" value={d.master ? "master" : "set"} options={[{ value: "set", label: "One of each" }, { value: "master", label: "Every printing" }]} />
        <Toggle name="rares" value={d.noRares ? "no" : "yes"} options={[{ value: "yes", label: "Include rares" }, { value: "no", label: "No rares" }]} />
        <Toggle name="reprints" value={d.noReprints ? "no" : "yes"} options={[{ value: "yes", label: "Every print" }, { value: "no", label: "Skip reprints" }]} />
      </div>

      {d.tracked.length ? (
        <div className="mb-5 flex flex-wrap gap-2">
          {d.tracked.map((t) => (
            <Link key={t.dexId} to={`?p=${t.dexId}`} className="w-40 rounded-lg border border-ink-800 bg-ink-900 px-2.5 py-1.5 text-xs hover:border-ink-600">
              <div className="flex justify-between">
                <span className="truncate">{t.name}</span>
                <span className="tnum text-ink-400">{Math.round(t.pct * 100)}%</span>
              </div>
              <div className="mt-1">
                <ProgressBar pct={t.pct} />
              </div>
            </Link>
          ))}
        </div>
      ) : null}

      {!d.species ? (
        <p className="rounded-xl border border-dashed border-ink-700 px-4 py-14 text-center text-sm text-ink-400">
          {d.q ? `No Pokémon matches “${d.q}”.` : "Choose a Pokémon to start."}
        </p>
      ) : (
        <>
          <div className="mb-4 flex flex-wrap items-center gap-4">
            <h2 className="text-lg font-semibold">
              #{d.species.dexId} {d.species.name}
            </h2>
            <Form method="post">
              <input type="hidden" name="intent" value="track" />
              <input type="hidden" name="dexId" value={d.species.dexId} />
              <input type="hidden" name="on" value={d.isTracked ? "0" : "1"} />
              <button className="rounded-md border border-ink-700 px-3 py-1 text-xs hover:border-accent">
                {d.isTracked ? "★ Tracking" : "☆ Track"}
              </button>
            </Form>
            {[d.master ? d.full : d.base].map((p) => (
              <div key="p" className="min-w-60 flex-1 text-xs">
                <div className="flex justify-between">
                  <span>
                    {p!.have}/{p!.total} · {Math.round(p!.pct * 100)}%
                  </span>
                  <span className="text-ink-500">{usd(p!.costToComplete)} to finish</span>
                </div>
                <ProgressBar pct={p!.pct} />
              </div>
            ))}
          </div>
          <Checklist cards={d.cards!} master={d.master} defaultCondition={d.defaultCondition!} />
        </>
      )}
    </>
  );
}
