import { Form } from "react-router";
import type { Signal } from "@/lib/sealed";

const TONE: Record<Signal["kind"], { icon: string; cls: string }> = {
  buy: { icon: "↓", cls: "bg-good/15 text-good ring-good/30" },
  sell: { icon: "↑", cls: "bg-amber-400/10 text-amber-300 ring-amber-400/30" },
  wait: { icon: "…", cls: "bg-ink-800 text-ink-300 ring-ink-700" },
  hold: { icon: "–", cls: "bg-ink-800 text-ink-400 ring-ink-700" },
  collecting: { icon: "◷", cls: "bg-ink-850 text-ink-500 ring-ink-800" },
};

/** Signal as icon + label (never colour alone), with the reasoning on hover. */
export function SignalBadge({ signal }: { signal: Signal }) {
  const t = TONE[signal.kind];
  return (
    <span title={signal.why} className={`inline-flex items-center gap-1 whitespace-nowrap rounded px-1.5 py-0.5 text-[10px] font-semibold ring-1 ${t.cls}`}>
      <span aria-hidden>{t.icon}</span>
      {signal.title}
    </span>
  );
}

export function Gain({ value, base }: { value: number | null; base?: number | null }) {
  if (value == null) return <span className="text-ink-500">—</span>;
  const pct = base ? value / base : null;
  const tone = value > 0.005 ? "text-good" : value < -0.005 ? "text-rose-400" : "text-ink-300";
  return (
    <span className={`tnum ${tone}`}>
      {value >= 0 ? "+" : "−"}${Math.abs(value).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
      {pct != null ? <span className="ml-1 text-[10px] opacity-80">({value >= 0 ? "+" : "−"}{Math.abs(pct * 100).toFixed(0)}%)</span> : null}
    </span>
  );
}

/** Shown on sealed pages for accounts that haven't switched it on. */
export function SealedIntro() {
  return (
    <div className="mx-auto max-w-xl py-12">
      <h1 className="text-2xl font-semibold tracking-tight">Sealed inventory</h1>
      <p className="mt-2 text-sm text-ink-300">
        For people who buy and sell sealed product: log every booster box, ETB, tin or case with what you paid, record
        sales, see profit, and watch prices with charts and buy / sell signals.
      </p>
      <p className="mt-2 text-sm text-ink-400">It's off by default to keep things simple for card collectors.</p>
      <Form method="post" action="/settings" className="mt-6">
        <input type="hidden" name="intent" value="sealed" />
        <input type="hidden" name="on" value="1" />
        <input type="hidden" name="next" value="/sealed" />
        <button className="rounded-md bg-accent px-4 py-2 text-sm font-semibold text-black">Turn on sealed inventory</button>
      </Form>
      <p className="mt-3 text-[11px] text-ink-500">You can turn it off again in Settings; nothing you've logged is deleted.</p>
    </div>
  );
}
