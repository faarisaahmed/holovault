import { Form, useNavigation } from "react-router";
import type { Route } from "./+types/sealed-product";
import { Toggle } from "@/components/controls";
import { PriceChart } from "@/components/price-chart";
import { Gain, SealedIntro, SignalBadge } from "@/components/sealed-ui";
import { Breadcrumbs } from "@/components/ui";
import { usd } from "@/lib/format";
import { CATEGORY_LABELS, signal, trend } from "@/lib/sealed";
import { requireUser } from "@/lib/server/auth.server";
import {
  addLot,
  addSale,
  deleteLot,
  deleteSale,
  lotInput,
  priceHistory,
  productLedger,
  saleInput,
  sealedEnabled,
  sealedProducts,
  setWatch,
} from "@/lib/server/sealed.server";

export const meta: Route.MetaFunction = ({ loaderData }) => [
  { title: `${loaderData?.enabled ? loaderData.product.name : "Sealed"} — Shadowless` },
];

const RANGES = { "30": 30, "90": 90, "365": 365, all: 3650 } as const;

export async function loader({ request, params }: Route.LoaderArgs) {
  const user = await requireUser(request);
  if (!(await sealedEnabled(user.id))) return { enabled: false as const };
  const id = Number(params.productId);
  const product = Number.isInteger(id) ? sealedProducts([id]).get(id) : undefined;
  if (!product) throw new Response("Product not found", { status: 404 });
  const range = (new URL(request.url).searchParams.get("range") ?? "90") as keyof typeof RANGES;
  const days = RANGES[range] ?? 90;
  const [ledger, all] = await Promise.all([productLedger(user.id, id), priceHistory([id], 3650)]);
  const points = all.get(id) ?? [];
  const t = trend(points);
  const since = new Date(Date.now() - days * 86_400_000).toISOString().slice(0, 10);
  return {
    enabled: true as const,
    product,
    range: RANGES[range] ? range : "90",
    points: points.filter((p) => p.day >= since),
    recordedDays: points.length,
    trend: t,
    signal: signal(t, ledger.holding.avgCost, ledger.holding.held > 0),
    ledger: {
      holding: ledger.holding,
      watched: ledger.watched,
      lots: ledger.lots.map((l) => ({ id: l.id, quantity: l.quantity, unitCost: l.unitCostCents / 100, boughtOn: l.boughtOn, notes: l.notes })),
      sales: ledger.sales.map((s) => ({ id: s.id, quantity: s.quantity, unitPrice: s.unitPriceCents / 100, fees: s.feesCents / 100, soldOn: s.soldOn, notes: s.notes })),
    },
  };
}

export async function action({ request, params }: Route.ActionArgs) {
  const user = await requireUser(request);
  const form = await request.formData();
  const productId = Number(params.productId);
  const values = { ...Object.fromEntries(form), productId: String(productId) };
  try {
    switch (String(form.get("intent"))) {
      case "buy": {
        const v = lotInput.safeParse(values);
        if (!v.success) return { error: v.error.issues[0]?.message ?? "Check the form.", form: "buy" };
        await addLot(user.id, v.data);
        return { ok: "Purchase saved.", form: "buy" };
      }
      case "sell": {
        const v = saleInput.safeParse(values);
        if (!v.success) return { error: v.error.issues[0]?.message ?? "Check the form.", form: "sell" };
        await addSale(user.id, v.data);
        return { ok: "Sale recorded.", form: "sell" };
      }
      case "delete-lot":
        await deleteLot(user.id, String(form.get("id")));
        return { ok: "Purchase removed.", form: "list" };
      case "delete-sale":
        await deleteSale(user.id, String(form.get("id")));
        return { ok: "Sale removed.", form: "list" };
      case "watch":
        await setWatch(user.id, productId, form.get("on") === "1");
        return { ok: null, form: "watch" };
    }
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Something went wrong.", form: String(form.get("intent")) };
  }
  return { error: "Unknown request.", form: "" };
}

export default function SealedProduct({ loaderData: d, actionData }: Route.ComponentProps) {
  const busy = useNavigation().state !== "idle";
  if (!d.enabled) return <SealedIntro />;
  const { product: p, ledger, trend: t } = d;
  const h = ledger.holding;
  const price = p.market ?? t?.current ?? null;
  const field = "rounded-md border border-ink-700 bg-ink-850 px-2 py-1 text-xs";
  const note = (form: string) =>
    actionData && actionData.form === form && (actionData.error || actionData.ok) ? (
      <p className={`w-full text-xs ${actionData.error ? "text-rose-300" : "text-good"}`}>{actionData.error ?? actionData.ok}</p>
    ) : null;
  const pct = (x: number | null | undefined) => (x == null ? "—" : `${x >= 0 ? "+" : "−"}${Math.abs(x * 100).toFixed(1)}%`);

  return (
    <>
      <Breadcrumbs items={[{ href: "/sealed", label: "Sealed" }, { label: p.name }]} />
      <div className="mb-5 flex flex-wrap items-start gap-4">
        {p.image ? <img src={p.image} alt="" className="h-20 w-20 shrink-0 rounded-lg sm:h-28 sm:w-28 bg-ink-850 object-contain p-1 ring-1 ring-ink-800" /> : null}
        <div className="min-w-0 flex-1">
          <h1 className="text-base font-semibold tracking-tight sm:text-xl">{p.name}</h1>
          <p className="mt-0.5 text-xs text-ink-400">
            {CATEGORY_LABELS[p.category] ?? p.category} · {p.setName} · {p.releaseDate}
            {p.url ? (
              <>
                {" · "}
                <a href={p.url} target="_blank" rel="noopener" className="underline hover:text-accent">
                  TCGplayer ↗
                </a>
              </>
            ) : null}
          </p>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <span className="tnum text-2xl font-semibold text-accent">{usd(price)}</span>
            <SignalBadge signal={d.signal} />
          </div>
          <p className="mt-1 text-xs text-ink-400">{d.signal.why}</p>
        </div>
        <Form method="post">
          <input type="hidden" name="intent" value="watch" />
          <input type="hidden" name="on" value={ledger.watched ? "0" : "1"} />
          <button className={`rounded-md border px-3 py-1.5 text-xs ${ledger.watched ? "border-accent text-accent" : "border-ink-700 hover:border-accent"}`}>
            {ledger.watched ? "★ Watching" : "☆ Watch"}
          </button>
        </Form>
      </div>

      <div className="grid gap-5 lg:grid-cols-[1fr_320px]">
        <section className="min-w-0 rounded-xl border border-ink-800 bg-ink-900 p-4">
          <div className="mb-3 flex flex-wrap items-center gap-2">
            <h2 className="text-sm font-semibold text-ink-200">Market price</h2>
            <div className="ml-auto">
              <Toggle
                name="range"
                value={d.range}
                options={[
                  { value: "30", label: "30D" },
                  { value: "90", label: "90D" },
                  { value: "365", label: "1Y" },
                  { value: "all", label: "All" },
                ]}
              />
            </div>
          </div>
          <PriceChart points={d.points} cost={h.held > 0 ? h.avgCost : null} />
          <p className="mt-2 text-[11px] text-ink-500">
            Recorded daily from TCGplayer market prices since this product was first tracked
            {d.recordedDays ? ` (${d.recordedDays} day${d.recordedDays === 1 ? "" : "s"} so far)` : ""}.
          </p>
        </section>

        <aside className="space-y-3">
          <div className="grid grid-cols-2 gap-2">
            {[
              ["7 days", pct(t?.change7)],
              ["30 days", pct(t?.change30)],
              ["90-day low", usd(t?.low90)],
              ["90-day high", usd(t?.high90)],
            ].map(([label, value]) => (
              <div key={label} className="rounded-lg border border-ink-800 bg-ink-900 px-3 py-2">
                <div className="text-[10px] uppercase tracking-wider text-ink-500">{label}</div>
                <div className="tnum text-sm font-semibold">{value}</div>
              </div>
            ))}
          </div>
          <div className="rounded-lg border border-ink-800 bg-ink-900 px-3 py-2 text-xs">
            <div className="mb-1 text-[10px] uppercase tracking-wider text-ink-500">Your position</div>
            <div className="flex justify-between">
              <span>Held</span>
              <span className="tnum">{h.held}</span>
            </div>
            <div className="flex justify-between">
              <span>Avg cost</span>
              <span className="tnum">{usd(h.avgCost)}</span>
            </div>
            <div className="flex justify-between">
              <span>Value</span>
              <span className="tnum">{price != null ? usd(price * h.held) : "—"}</span>
            </div>
            <div className="flex justify-between">
              <span>Unrealized</span>
              <Gain value={price != null && h.avgCost != null && h.held ? (price - h.avgCost) * h.held : null} base={h.costBasis} />
            </div>
            <div className="flex justify-between">
              <span>Realized</span>
              <Gain value={h.sold ? h.realized : null} />
            </div>
          </div>
        </aside>
      </div>

      <div className="mt-5 grid gap-4 md:grid-cols-2">
        <Form method="post" className="flex flex-wrap items-end gap-2 rounded-xl border border-ink-800 bg-ink-900 p-3">
          <input type="hidden" name="intent" value="buy" />
          <h3 className="w-full text-sm font-semibold">Log a purchase</h3>
          <input name="quantity" type="number" min={1} max={10000} defaultValue={1} aria-label="Quantity" className={`${field} w-16`} />
          <input name="unitCost" inputMode="decimal" required placeholder="Paid each" defaultValue={price?.toFixed(2)} aria-label="Paid each" className={`${field} w-24`} />
          <input name="boughtOn" type="date" defaultValue={new Date().toISOString().slice(0, 10)} aria-label="Bought on" className={field} />
          <input name="notes" maxLength={300} placeholder="Notes" aria-label="Notes" className={`${field} min-w-24 flex-1`} />
          <button disabled={busy} className="rounded-md bg-accent px-3 py-1.5 text-xs font-semibold text-black">
            Save
          </button>
          {note("buy")}
        </Form>
        <Form method="post" className="flex flex-wrap items-end gap-2 rounded-xl border border-ink-800 bg-ink-900 p-3">
          <input type="hidden" name="intent" value="sell" />
          <h3 className="w-full text-sm font-semibold">Record a sale {h.held ? <span className="font-normal text-ink-500">({h.held} held)</span> : null}</h3>
          <input name="quantity" type="number" min={1} max={Math.max(1, h.held)} defaultValue={1} aria-label="Quantity" className={`${field} w-16`} disabled={!h.held} />
          <input name="unitPrice" inputMode="decimal" required placeholder="Sold each" defaultValue={price?.toFixed(2)} aria-label="Sold each" className={`${field} w-24`} disabled={!h.held} />
          <input name="fees" inputMode="decimal" placeholder="Fees & shipping" aria-label="Fees and shipping, total" className={`${field} w-32`} disabled={!h.held} />
          <input name="soldOn" type="date" defaultValue={new Date().toISOString().slice(0, 10)} aria-label="Sold on" className={field} disabled={!h.held} />
          <button disabled={busy || !h.held} className="rounded-md border border-ink-600 px-3 py-1.5 text-xs font-semibold hover:border-accent disabled:opacity-40">
            Record
          </button>
          {note("sell")}
        </Form>
      </div>

      {ledger.lots.length || ledger.sales.length ? (
        <section className="mt-5">
          <h2 className="mb-2 text-sm font-semibold text-ink-200">History</h2>
          {note("list")}
          <ul className="divide-y divide-ink-850 rounded-xl border border-ink-800 bg-ink-900 text-xs">
            {[
              ...ledger.lots.map((l) => ({ kind: "buy" as const, ...l, date: l.boughtOn })),
              ...ledger.sales.map((s) => ({ kind: "sell" as const, ...s, date: s.soldOn })),
            ]
              .sort((a, b) => String(b.date ?? "").localeCompare(String(a.date ?? "")))
              .map((e) => (
                <li key={e.id} className="flex flex-wrap items-center gap-3 px-3 py-2">
                  <span className={`w-12 font-semibold ${e.kind === "buy" ? "text-ink-200" : "text-amber-300"}`}>{e.kind === "buy" ? "Bought" : "Sold"}</span>
                  <span className="tnum">
                    {e.quantity} × {usd(e.kind === "buy" ? e.unitCost : e.unitPrice)}
                    {e.kind === "sell" && e.fees ? <span className="text-ink-500"> − {usd(e.fees)} fees</span> : null}
                  </span>
                  <span className="text-ink-500">{e.date ?? "no date"}</span>
                  {e.notes ? <span className="truncate text-ink-400">{e.notes}</span> : null}
                  <Form
                    method="post"
                    className="ml-auto"
                    onSubmit={(ev) => {
                      if (!confirm(`Remove this ${e.kind === "buy" ? "purchase" : "sale"}?`)) ev.preventDefault();
                    }}
                  >
                    <input type="hidden" name="intent" value={e.kind === "buy" ? "delete-lot" : "delete-sale"} />
                    <input type="hidden" name="id" value={e.id} />
                    <button className="text-[11px] text-ink-500 underline hover:text-rose-300">Remove</button>
                  </Form>
                </li>
              ))}
          </ul>
        </section>
      ) : null}
    </>
  );
}
