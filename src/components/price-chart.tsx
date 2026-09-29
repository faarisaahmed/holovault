import { useEffect, useId, useRef, useState } from "react";
import { usd } from "@/lib/format";
import type { PricePoint } from "@/lib/sealed";

/**
 * Market price over time for one sealed product. One series, so no legend:
 * the heading names it. 2px line with a 10% wash, hairline grid, clean
 * ticks, a crosshair that snaps to the nearest recorded day, and the owner's
 * average cost as a labelled reference line. A table view carries every value.
 */

const niceStep = (range: number, count: number) => {
  const raw = range / Math.max(1, count);
  const mag = 10 ** Math.floor(Math.log10(raw));
  const norm = raw / mag;
  return (norm >= 5 ? 10 : norm >= 2 ? 5 : norm >= 1 ? 2 : 1) * mag;
};

const monthFmt = new Intl.DateTimeFormat("en-US", { month: "short", timeZone: "UTC" });
const dayFmt = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });
const ts = (d: string) => Date.parse(`${d}T00:00:00Z`);

export function PriceChart({ points, cost, height = 260 }: { points: PricePoint[]; cost?: number | null; height?: number }) {
  const wrap = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(720);
  const [hover, setHover] = useState<number | null>(null);
  const gradId = useId();

  useEffect(() => {
    const el = wrap.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setWidth(Math.max(280, Math.round(e.contentRect.width))));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  if (points.length < 2) {
    return (
      <div ref={wrap} className="grid place-items-center rounded-lg border border-dashed border-ink-700 text-center text-xs text-ink-500" style={{ height }}>
        <p className="max-w-xs px-4">
          {points.length === 1
            ? `One price recorded so far (${usd(points[0].market)}). The chart fills in with each daily update.`
            : "No prices recorded yet. The chart fills in with each daily update."}
        </p>
      </div>
    );
  }

  const pad = { top: 16, right: 16, bottom: 26, left: 56 };
  const w = width - pad.left - pad.right;
  const h = height - pad.top - pad.bottom;
  const t0 = ts(points[0].day);
  const t1 = ts(points[points.length - 1].day);
  const values = points.map((p) => p.market).concat(cost != null ? [cost] : []);
  let lo = Math.min(...values);
  let hi = Math.max(...values);
  if (hi === lo) {
    hi += Math.max(1, hi * 0.05);
    lo = Math.max(0, lo - Math.max(1, lo * 0.05));
  }
  const step = niceStep(hi - lo, 4);
  const yMin = Math.max(0, Math.floor(lo / step) * step);
  const yMax = Math.ceil(hi / step) * step;
  const x = (d: string) => pad.left + ((ts(d) - t0) / Math.max(1, t1 - t0)) * w;
  const y = (v: number) => pad.top + h - ((v - yMin) / (yMax - yMin)) * h;
  const ticks: number[] = [];
  for (let v = yMin; v <= yMax + step / 2; v += step) ticks.push(v);

  // Month labels where the month changes, thinned to fit.
  const months: { x: number; label: string }[] = [];
  let prev = "";
  for (const p of points) {
    const m = p.day.slice(0, 7);
    if (m !== prev) {
      months.push({ x: x(p.day), label: monthFmt.format(ts(p.day)) });
      prev = m;
    }
  }
  const every = Math.ceil(months.length / Math.max(1, Math.floor(w / 70)));
  const line = points.map((p, i) => `${i ? "L" : "M"}${x(p.day).toFixed(1)},${y(p.market).toFixed(1)}`).join("");
  const area = `${line}L${x(points[points.length - 1].day).toFixed(1)},${pad.top + h}L${pad.left},${pad.top + h}Z`;
  const last = points[points.length - 1];
  const hp = hover != null ? points[hover] : null;

  const onMove = (e: React.PointerEvent<SVGRectElement>) => {
    const box = e.currentTarget.getBoundingClientRect();
    const px = e.clientX - box.left + pad.left;
    let best = 0;
    for (let i = 1; i < points.length; i++) if (Math.abs(x(points[i].day) - px) < Math.abs(x(points[best].day) - px)) best = i;
    setHover(best);
  };

  return (
    <div ref={wrap} className="relative">
      <svg width={width} height={height} role="img" aria-label={`Market price from ${points[0].day} to ${last.day}, now ${usd(last.market)}`}>
        <defs>
          <linearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="var(--color-accent)" stopOpacity="0.14" />
            <stop offset="1" stopColor="var(--color-accent)" stopOpacity="0.02" />
          </linearGradient>
        </defs>
        {ticks.map((v) => (
          <g key={v}>
            <line x1={pad.left} x2={pad.left + w} y1={y(v)} y2={y(v)} stroke="var(--color-ink-800)" strokeWidth={1} />
            <text x={pad.left - 8} y={y(v)} dy="0.32em" textAnchor="end" className="tnum" fontSize={10} fill="var(--color-ink-500)">
              {usd(v, { compact: true })}
            </text>
          </g>
        ))}
        {months.map((m, i) =>
          i % every === 0 ? (
            <text key={i} x={m.x} y={height - 8} textAnchor="middle" fontSize={10} fill="var(--color-ink-500)">
              {m.label}
            </text>
          ) : null,
        )}
        <path d={area} fill={`url(#${gradId})`} />
        <path d={line} fill="none" stroke="var(--color-accent)" strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
        {cost != null ? (
          <g>
            <line x1={pad.left} x2={pad.left + w} y1={y(cost)} y2={y(cost)} stroke="var(--color-ink-400)" strokeWidth={1} />
            {/* A halo in the surface colour keeps the label legible where the price line crosses it. */}
            <text
              x={pad.left + w - 4}
              y={y(cost) - 5}
              textAnchor="end"
              fontSize={10}
              fill="var(--color-ink-300)"
              stroke="var(--color-ink-900)"
              strokeWidth={4}
              paintOrder="stroke"
            >
              Your avg cost {usd(cost)}
            </text>
          </g>
        ) : null}
        <circle cx={x(last.day)} cy={y(last.market)} r={4} fill="var(--color-accent)" stroke="var(--color-ink-900)" strokeWidth={2} />
        {hp ? (
          <g pointerEvents="none">
            <line x1={x(hp.day)} x2={x(hp.day)} y1={pad.top} y2={pad.top + h} stroke="var(--color-ink-500)" strokeWidth={1} />
            <circle cx={x(hp.day)} cy={y(hp.market)} r={4} fill="var(--color-accent)" stroke="var(--color-ink-900)" strokeWidth={2} />
          </g>
        ) : null}
        <rect
          x={pad.left}
          y={pad.top}
          width={w}
          height={h}
          fill="transparent"
          onPointerMove={onMove}
          onPointerLeave={() => setHover(null)}
        />
      </svg>
      {hp ? (
        <div
          className="pointer-events-none absolute top-2 rounded-md border border-ink-700 bg-ink-900 px-2.5 py-1.5 text-xs shadow-lg"
          style={{ left: Math.min(width - 150, Math.max(0, x(hp.day) + 10)) }}
        >
          <div className="tnum font-semibold text-ink-100">{usd(hp.market)}</div>
          <div className="text-[10px] text-ink-400">{dayFmt.format(ts(hp.day))}</div>
        </div>
      ) : null}
      <details className="mt-2 text-xs text-ink-400">
        <summary className="cursor-pointer select-none hover:text-ink-200">Show as table</summary>
        <div className="mt-2 max-h-56 overflow-y-auto rounded-md border border-ink-800">
          <table className="w-full text-left">
            <thead className="sticky top-0 bg-ink-900 text-[10px] uppercase tracking-wider text-ink-500">
              <tr>
                <th className="px-2 py-1 font-medium">Date</th>
                <th className="px-2 py-1 text-right font-medium">Market</th>
              </tr>
            </thead>
            <tbody>
              {[...points].reverse().map((p) => (
                <tr key={p.day} className="border-t border-ink-850">
                  <td className="px-2 py-1">{dayFmt.format(ts(p.day))}</td>
                  <td className="tnum px-2 py-1 text-right text-ink-200">{usd(p.market)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    </div>
  );
}

/** A tiny trend line for tables: no axes, just the shape and the latest point. */
export function Sparkline({ points, width = 96, height = 28 }: { points: PricePoint[]; width?: number; height?: number }) {
  if (points.length < 2) return <span className="text-[10px] text-ink-600">collecting…</span>;
  const vals = points.map((p) => p.market);
  const lo = Math.min(...vals);
  const hi = Math.max(...vals);
  const x = (i: number) => 2 + (i / (points.length - 1)) * (width - 6);
  const y = (v: number) => (hi === lo ? height / 2 : 3 + (1 - (v - lo) / (hi - lo)) * (height - 6));
  const d = points.map((p, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(p.market).toFixed(1)}`).join("");
  return (
    <svg width={width} height={height} aria-hidden>
      <path d={d} fill="none" stroke="var(--color-accent)" strokeWidth={1.5} strokeLinejoin="round" strokeLinecap="round" />
      <circle cx={x(points.length - 1)} cy={y(vals[vals.length - 1])} r={2.5} fill="var(--color-accent)" />
    </svg>
  );
}
