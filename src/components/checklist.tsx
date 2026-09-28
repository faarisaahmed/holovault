import { useFetcher } from "react-router";
import { usd } from "@/lib/format";
import { finishShort } from "./finish";

export interface ChecklistCard {
  id: string;
  name: string;
  localId: string;
  subtitle?: string;
  image: string | null;
  finishes: { name: string; price: number | null; owned: number }[];
}

/**
 * A grid of cards where anything not owned is dimmed. Each printing is a chip:
 * filled when owned, and a click on an empty one adds a copy in the user's
 * default condition (posting intent "add" to the page's action).
 */
export function Checklist({
  cards,
  master,
  defaultCondition,
}: {
  cards: ChecklistCard[];
  master: boolean;
  defaultCondition: string;
}) {
  return (
    <div className="grid grid-cols-3 gap-x-2.5 gap-y-4 sm:grid-cols-4 md:grid-cols-6 lg:grid-cols-8">
      {cards.map((c) => (
        <ChecklistTile key={c.id} card={c} master={master} defaultCondition={defaultCondition} />
      ))}
    </div>
  );
}

function ChecklistTile({ card, master, defaultCondition }: { card: ChecklistCard; master: boolean; defaultCondition: string }) {
  const fetcher = useFetcher();
  const ownedAny = card.finishes.some((f) => f.owned > 0);
  const complete = master ? card.finishes.every((f) => f.owned > 0) : ownedAny;
  const pending = fetcher.state !== "idle" ? String(fetcher.formData?.get("finish")) : null;
  return (
    <div className="flex flex-col">
      <div className={`relative overflow-hidden rounded-md ring-1 ${complete ? "ring-good/60" : "ring-ink-800"}`}>
        {card.image ? (
          <img
            src={card.image}
            alt={card.name}
            loading="lazy"
            className={`aspect-[245/342] w-full object-cover transition ${ownedAny ? "" : "opacity-30 grayscale"}`}
          />
        ) : (
          <div className="grid aspect-[245/342] place-items-center bg-ink-850 px-1 text-center text-[9px] text-ink-600">{card.name}</div>
        )}
        {complete ? <span className="absolute right-1 top-1 rounded-full bg-good px-1 text-[10px] font-bold text-black">✓</span> : null}
      </div>
      <div className="mt-1 truncate text-[10px] text-ink-300" title={card.name}>
        <span className="text-ink-500">{card.localId}</span> {card.name}
      </div>
      {card.subtitle ? <div className="truncate text-[9px] text-ink-500">{card.subtitle}</div> : null}
      <div className="mt-0.5 flex flex-wrap gap-0.5">
        {card.finishes.map((f) =>
          f.owned > 0 ? (
            <span key={f.name} title={`${f.name}: ${f.owned} owned`} className="rounded bg-good/15 px-1 py-px text-[9px] text-good ring-1 ring-good/30">
              {finishShort(f.name)} ×{f.owned}
            </span>
          ) : (
            <fetcher.Form method="post" key={f.name}>
              <input type="hidden" name="intent" value="add" />
              <input type="hidden" name="cardId" value={card.id} />
              <input type="hidden" name="finish" value={f.name} />
              <input type="hidden" name="condition" value={defaultCondition} />
              <button
                title={`Add a ${f.name} copy (${defaultCondition})${f.price != null ? ` — ${usd(f.price)}` : ""}`}
                disabled={pending === f.name}
                className="rounded px-1 py-px text-[9px] text-ink-500 ring-1 ring-ink-700 hover:text-accent hover:ring-accent disabled:opacity-40"
              >
                + {finishShort(f.name)}
              </button>
            </fetcher.Form>
          ),
        )}
      </div>
    </div>
  );
}

export function ProgressBar({ pct, tone = "bg-good" }: { pct: number; tone?: string }) {
  return (
    <div className="h-1.5 rounded bg-ink-800">
      <div className={`h-1.5 rounded ${tone}`} style={{ width: `${Math.min(100, pct * 100)}%` }} />
    </div>
  );
}
