import { useFetcher } from "react-router";

/** "♡ Want" → adds the card to the wishlist in place. Posts to /wishlist. */
export function WantButton({ cardId, finish, wanted, compact }: { cardId: string; finish?: string; wanted: boolean; compact?: boolean }) {
  const f = useFetcher();
  const on = wanted || (f.data as { ok?: boolean } | undefined)?.ok === true || f.state !== "idle";
  return (
    <f.Form method="post" action="/wishlist" onClick={(e) => e.stopPropagation()}>
      <input type="hidden" name="intent" value="want" />
      <input type="hidden" name="cardId" value={cardId} />
      {finish ? <input type="hidden" name="finish" value={finish} /> : null}
      <button
        disabled={on}
        title={on ? "On your wishlist" : "Add to your wishlist"}
        className={
          compact
            ? `grid h-6 w-6 place-items-center rounded-full bg-black/60 text-xs ${on ? "text-rose-300" : "text-white hover:text-rose-300"}`
            : `rounded border px-1.5 py-0.5 text-[10px] transition-colors ${
                on ? "border-rose-400/40 text-rose-300" : "border-ink-700 bg-ink-850 text-ink-300 hover:border-rose-400/60 hover:text-rose-300"
              }`
        }
      >
        {on ? "♥" : "♡"}
        {compact ? null : on ? " Wanted" : " Want"}
      </button>
    </f.Form>
  );
}
