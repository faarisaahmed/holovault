import { useCallback, useSyncExternalStore } from "react";
import { CONDITIONS } from "@/lib/valuation";

const KEY = "shadowless:add-condition";
const listeners = new Set<() => void>();
/** Stand-in when storage is blocked: the pick lasts until the page closes. */
let memory: string | null = null;

function readSaved(): string | null {
  try {
    const saved = window.localStorage.getItem(KEY);
    return saved && CONDITIONS.some((c) => c.code === saved) ? saved : memory;
  } catch {
    return memory;
  }
}

function subscribe(fn: () => void) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/**
 * The condition quick adds use. It starts at the account default and then
 * remembers the last pick on this device, so a stack of fresh pulls can all go
 * in as Mint without choosing it every time. The server renders the default;
 * the saved pick takes over once the page is running.
 */
export function useStickyCondition(fallback: string): [string, (c: string) => void] {
  const saved = useSyncExternalStore(subscribe, readSaved, () => null);
  const set = useCallback((c: string) => {
    try {
      window.localStorage.setItem(KEY, c);
    } catch {
      // Private mode or blocked storage.
    }
    memory = c;
    listeners.forEach((fn) => fn());
  }, []);
  return [saved ?? fallback, set];
}

const TIPS: Record<string, string> = {
  M: "Mint: fresh from the pack, flawless",
  NM: "Near Mint: maybe a speck, looks new",
  LP: "Lightly Played: light edge or corner wear",
  MP: "Moderately Played: clear wear, creases start here",
  HP: "Heavily Played: lots of wear, bends",
  DMG: "Damaged: tears, water damage, big creases",
};

/** Six condition chips in a row. */
export function ConditionPicker({ value, onChange, label = "Condition" }: { value: string; onChange: (c: string) => void; label?: string }) {
  return (
    <div className="flex flex-wrap items-center gap-1.5" role="radiogroup" aria-label={label}>
      <span className="mr-0.5 text-[10px] uppercase tracking-wider text-ink-500">{label}</span>
      {CONDITIONS.map((c) => (
        <button
          key={c.code}
          type="button"
          role="radio"
          aria-checked={value === c.code}
          title={TIPS[c.code]}
          onClick={() => onChange(c.code)}
          className={`rounded-md border px-2 py-1 text-xs font-semibold transition-colors ${
            value === c.code ? "border-accent bg-accent/15 text-accent" : "border-ink-700 bg-ink-850 text-ink-300 hover:border-ink-600"
          }`}
        >
          {c.short}
        </button>
      ))}
    </div>
  );
}
