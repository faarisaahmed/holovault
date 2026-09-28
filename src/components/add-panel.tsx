import { useEffect, useState } from "react";
import { useFetcher } from "react-router";
import { usd } from "@/lib/format";
import { CONDITIONS, GRADERS, GRADES } from "@/lib/valuation";
import { finishShort } from "./finish";

export interface AddableCard {
  id: string;
  name: string;
  setName: string;
  localId: string;
  officialCount: number;
  image: string | null;
  finishes: { name: string; price: number | null }[];
}

const chip = (on: boolean) =>
  `rounded-md border px-2.5 py-1 text-xs transition-colors ${
    on ? "border-accent bg-accent/15 text-accent" : "border-ink-700 bg-ink-850 text-ink-300 hover:border-ink-600"
  }`;

/**
 * Every option for adding a card: printing, raw condition or a slab with its
 * grade, quantity, and optional price paid. Posts to the page's action with
 * intent "add".
 */
export function AddPanel({
  card,
  defaultCondition,
  onDone,
}: {
  card: AddableCard;
  defaultCondition: string;
  onDone: () => void;
}) {
  const fetcher = useFetcher();
  const [finish, setFinish] = useState(card.finishes[0]?.name ?? "Normal");
  const [graded, setGraded] = useState(false);
  const [condition, setCondition] = useState(defaultCondition);
  const [grader, setGrader] = useState<string>("PSA");
  const [grade, setGrade] = useState("10");
  const [qty, setQty] = useState(1);

  useEffect(() => {
    if (fetcher.state === "idle" && fetcher.data && !(fetcher.data as { error?: string }).error) onDone();
  }, [fetcher.state, fetcher.data, onDone]);

  const error = (fetcher.data as { error?: string } | undefined)?.error;
  const price = card.finishes.find((f) => f.name === finish)?.price ?? null;

  return (
    <fetcher.Form method="post" className="rounded-xl border border-accent/40 bg-ink-900 p-4 shadow-lg">
      <input type="hidden" name="intent" value="add" />
      <input type="hidden" name="cardId" value={card.id} />
      <input type="hidden" name="finish" value={finish} />
      {graded ? (
        <>
          <input type="hidden" name="grader" value={grader} />
          <input type="hidden" name="grade" value={grade} />
        </>
      ) : (
        <input type="hidden" name="condition" value={condition} />
      )}
      <div className="flex gap-4">
        {card.image ? <img src={card.image} alt="" className="h-40 w-auto rounded-md ring-1 ring-ink-700" /> : null}
        <div className="min-w-0 flex-1 space-y-3">
          <div>
            <div className="font-semibold">{card.name}</div>
            <div className="text-xs text-ink-400">
              {card.setName} · {card.localId}
              {card.officialCount ? `/${card.officialCount}` : ""}
            </div>
          </div>

          <div>
            <div className="mb-1 text-[10px] uppercase tracking-wider text-ink-500">Printing</div>
            <div className="flex flex-wrap gap-1.5">
              {card.finishes.map((f) => (
                <button type="button" key={f.name} onClick={() => setFinish(f.name)} className={chip(finish === f.name)}>
                  {finishShort(f.name)} <span className="text-ink-500">{usd(f.price)}</span>
                </button>
              ))}
            </div>
          </div>

          <div>
            <div className="mb-1 flex items-center gap-3 text-[10px] uppercase tracking-wider text-ink-500">
              <button type="button" onClick={() => setGraded(false)} className={!graded ? "text-accent" : "hover:text-ink-300"}>
                Raw
              </button>
              <button type="button" onClick={() => setGraded(true)} className={graded ? "text-accent" : "hover:text-ink-300"}>
                Graded
              </button>
            </div>
            {graded ? (
              <div className="flex flex-wrap items-center gap-1.5">
                <select value={grader} onChange={(e) => setGrader(e.target.value)} className="rounded-md border border-ink-700 bg-ink-850 px-2 py-1 text-xs">
                  {GRADERS.map((g) => (
                    <option key={g}>{g}</option>
                  ))}
                </select>
                <select value={grade} onChange={(e) => setGrade(e.target.value)} className="rounded-md border border-ink-700 bg-ink-850 px-2 py-1 text-xs">
                  {GRADES.map((g) => (
                    <option key={g} value={g}>
                      {g}
                    </option>
                  ))}
                </select>
                <input name="certNumber" placeholder="Cert # (optional)" maxLength={40} className="w-36 rounded-md border border-ink-700 bg-ink-850 px-2 py-1 text-xs" />
              </div>
            ) : (
              <div className="flex flex-wrap gap-1.5">
                {CONDITIONS.map((c) => (
                  <button type="button" key={c.code} title={c.label} onClick={() => setCondition(c.code)} className={chip(condition === c.code)}>
                    {c.short}
                  </button>
                ))}
              </div>
            )}
          </div>

          <div className="flex flex-wrap items-end gap-3">
            <label className="text-xs text-ink-400">
              <span className="mb-1 block text-[10px] uppercase tracking-wider text-ink-500">Copies</span>
              <span className="flex items-center gap-1">
                <button type="button" onClick={() => setQty((q) => Math.max(1, q - 1))} className="h-7 w-7 rounded-md border border-ink-700">
                  −
                </button>
                <input name="quantity" value={qty} onChange={(e) => setQty(Math.max(1, Number(e.target.value) || 1))} inputMode="numeric" className="h-7 w-12 rounded-md border border-ink-700 bg-ink-850 text-center text-sm" />
                <button type="button" onClick={() => setQty((q) => Math.min(999, q + 1))} className="h-7 w-7 rounded-md border border-ink-700">
                  +
                </button>
              </span>
            </label>
            <label className="text-xs text-ink-400">
              <span className="mb-1 block text-[10px] uppercase tracking-wider text-ink-500">Paid each (optional)</span>
              <input name="purchase" inputMode="decimal" placeholder={price != null ? price.toFixed(2) : "0.00"} className="h-7 w-24 rounded-md border border-ink-700 bg-ink-850 px-2 text-sm" />
            </label>
            <div className="ml-auto flex gap-2">
              <button type="button" onClick={onDone} className="rounded-md px-3 py-1.5 text-xs text-ink-400 hover:text-ink-200">
                Cancel
              </button>
              <button disabled={fetcher.state !== "idle"} className="rounded-md bg-accent px-4 py-1.5 text-sm font-semibold text-black disabled:opacity-50">
                Add {qty > 1 ? `${qty} copies` : ""}
              </button>
            </div>
          </div>
          {error ? <p className="text-xs text-rose-300">{error}</p> : null}
        </div>
      </div>
    </fetcher.Form>
  );
}
