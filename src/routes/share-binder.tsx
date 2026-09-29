import { Link } from "react-router";
import type { Route } from "./+types/share-binder";
import { sharedBinder } from "@/lib/server/share.server";

export const meta: Route.MetaFunction = ({ loaderData }) => [
  { title: loaderData ? `${loaderData.owner}'s ${loaderData.name} — Shadowless` : "Shared binder — Shadowless" },
  // Shared by link, not published: keep it out of search engines.
  { name: "robots", content: "noindex, nofollow" },
];

export async function loader({ params }: Route.LoaderArgs) {
  const b = await sharedBinder(params.token);
  if (!b) throw new Response("This link isn't shared any more.", { status: 404 });
  return b;
}

export default function SharedBinder({ loaderData: b }: Route.ComponentProps) {
  const pct = b.total ? Math.round((b.owned / b.total) * 100) : 0;
  return (
    <>
      <div className="mb-4">
        <p className="text-xs text-ink-500">{b.owner}'s binder</p>
        <h1 className="text-2xl font-semibold tracking-tight">{b.name}</h1>
        <p className="mt-1 text-xs text-ink-400">
          {b.rows}×{b.cols} · {b.pages.length} pages · {b.owned}/{b.total} filled ({pct}%)
        </p>
      </div>
      <div className="grid gap-4 lg:grid-cols-2">
        {b.pages.map((page, n) => (
          <div key={n} className="rounded-xl border border-ink-700 bg-ink-900 p-3">
            <div className="grid gap-2" style={{ gridTemplateColumns: `repeat(${b.cols}, minmax(0, 1fr))` }}>
              {Array.from({ length: b.rows * b.cols }, (_, i) => page[i] ?? null).map((s, i) => (
                <div key={s?.key ?? `e${i}`} className="relative aspect-[245/342] overflow-hidden rounded-md bg-ink-850 ring-1 ring-ink-800" title={s?.card ? `${s.card.name} · ${s.card.setName} ${s.card.localId}` : s?.label}>
                  {s?.card?.image ? <img src={s.card.image} alt={s.card.name} loading="lazy" className={`h-full w-full object-cover ${s.owned ? "" : "opacity-25 grayscale"}`} /> : null}
                  {s && !s.owned ? (
                    <span className="absolute inset-x-0 bottom-0 bg-black/70 px-1 py-0.5 text-center text-[9px] text-ink-200">{s.card ? s.card.name : s.label}</span>
                  ) : null}
                </div>
              ))}
            </div>
            <div className="mt-2 text-center text-[10px] text-ink-500">Page {n + 1}</div>
          </div>
        ))}
      </div>
      <p className="mt-6 text-center text-[11px] text-ink-500">
        Shared from{" "}
        <Link to="/" className="underline hover:text-ink-300">
          Shadowless
        </Link>
        , a private Pokémon card collection tracker.
      </p>
    </>
  );
}
