import { Link } from "react-router";
import type { Route } from "./+types/share-collection";
import { CopyBadge, finishShort } from "@/components/finish";
import { usd } from "@/lib/format";
import { sharedCollection } from "@/lib/server/share.server";

export const meta: Route.MetaFunction = ({ loaderData }) => [
  { title: loaderData ? `${loaderData.owner}'s collection — Shadowless` : "Shared collection — Shadowless" },
  { name: "robots", content: "noindex, nofollow" },
];

export async function loader({ params }: Route.LoaderArgs) {
  const c = await sharedCollection(params.token);
  if (!c) throw new Response("This link isn't shared any more.", { status: 404 });
  return c;
}

export default function SharedCollection({ loaderData: c }: Route.ComponentProps) {
  return (
    <>
      <div className="mb-4">
        <h1 className="text-2xl font-semibold tracking-tight">{c.owner}'s collection</h1>
        <p className="mt-1 text-sm text-ink-400">
          {c.copies.toLocaleString()} cards{c.total != null ? ` · ${usd(c.total)} at market` : ""}
        </p>
      </div>
      <div className="grid grid-cols-3 gap-x-3 gap-y-4 sm:grid-cols-4 md:grid-cols-6 lg:grid-cols-8">
        {c.items.map((i) => (
          <div key={i.id} className="flex flex-col">
            <span className="relative block overflow-hidden rounded-lg bg-ink-850 ring-1 ring-ink-800">
              {i.image ? <img src={i.image} alt={i.name} loading="lazy" className="aspect-[245/342] w-full object-cover" /> : <span className="grid aspect-[245/342] place-items-center text-[10px] text-ink-500">{i.name}</span>}
              {i.quantity > 1 ? <span className="absolute right-1 top-1 rounded bg-ink-950/85 px-1.5 py-0.5 text-[10px] font-bold">×{i.quantity}</span> : null}
            </span>
            <span className="mt-1.5 flex items-baseline justify-between gap-1 px-0.5">
              <span className="truncate text-[11px] text-ink-200">{i.name}</span>
              {i.value != null ? <span className="tnum shrink-0 text-[11px] font-semibold text-accent">{usd(i.value, { compact: true })}</span> : null}
            </span>
            <span className="flex items-center gap-1 px-0.5 text-[10px] text-ink-500">
              <span className="truncate">{i.setName}</span> · {finishShort(i.finish)} <CopyBadge condition={i.condition} grader={i.grader} grade={i.grade} />
            </span>
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
