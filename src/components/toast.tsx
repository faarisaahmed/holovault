import { useEffect } from "react";
import { useFetcher } from "react-router";
import { finishShort } from "./finish";

export interface Added {
  id: string;
  name: string;
  finish: string;
  label: string;
  quantity: number;
  /** When it was added; tells two adds of the same row apart. */
  at: number;
}

/** "Added Charizard ex · Holo · NM — Undo", dismissing itself after a few seconds. */
export function AddedToast({ added, onClose }: { added: Added | null; onClose: () => void }) {
  const undo = useFetcher();
  useEffect(() => {
    if (!added) return;
    const t = setTimeout(onClose, 6000);
    return () => clearTimeout(t);
  }, [added, onClose]);
  if (!added) return null;
  return (
    <div role="status" className="fixed bottom-4 left-1/2 z-50 flex -translate-x-1/2 items-center gap-3 rounded-lg border border-ink-700 bg-ink-850 px-4 py-2.5 text-sm shadow-xl">
      <span>
        Added {added.quantity > 1 ? `${added.quantity}× ` : ""}
        <strong>{added.name}</strong>{" "}
        <span className="text-ink-400">
          · {finishShort(added.finish)} · {added.label}
        </span>
      </span>
      <undo.Form method="post" onSubmit={() => setTimeout(onClose, 50)}>
        <input type="hidden" name="intent" value="undo" />
        <input type="hidden" name="id" value={added.id} />
        <input type="hidden" name="quantity" value={added.quantity} />
        <button className="text-xs font-semibold text-accent underline">Undo</button>
      </undo.Form>
    </div>
  );
}
