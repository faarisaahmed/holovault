import { Form, Link } from "react-router";
import type { Route } from "./+types/sealed";
import { Sparkline } from "@/components/price-chart";
import { Gain, SealedIntro, SignalBadge } from "@/components/sealed-ui";
import { usd } from "@/lib/format";
import { CATEGORY_LABELS } from "@/lib/sealed";
import { requireUser } from "@/lib/server/auth.server";
import { inventory, sealedEnabled, setWatch } from "@/lib/server/sealed.server";

export const meta: Route.MetaFunction = () => [{ title: "Sealed — Shadowless" }];

export async function loader({ request }: Route.LoaderArgs) {
  const user = await requireUser(request);
  if (!(await sealedEnabled(user.id))) return { enabled: false as const };
  const { positions, totals } = await inventory(user.id);
  const held = positions.filter((p) => p.holding.held > 0).sort((a, b) => (b.value ?? 0) - (a.value ?? 0));
  const watching = positions.filter((p) => p.watched && p.holding.held === 0);
  const closed = positions.filter((p) => p.holding.held === 0 && p.holding.sold > 0 && !p.watched);
  return { enabled: true as const, held, watching, closed, totals };
}

export async function action({ request }: Route.ActionArgs) {
  const user = await requireUser(request);
  const form = await request.formData();
  if (form.get("intent") === "unwatch") await setWatch(user.id, Number(form.get("productId")), false);
  return { ok: true };
}

export default function Sealed({ loaderData: d }: Route.ComponentProps) {
  if (!d.enabled) return <SealedIntro />;
  const unrealized = d.totals.value - d.totals.cost;
  return (
    <>
      <div className="mb-4 flex flex-wrap items-end gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Sealed inventory</h1>
          <p className="mt-1 text-sm text-ink-400">{d.totals.units.toLocaleString()} units held</p>
        </div>
        <Link to="/sealed/add" className="ml-auto rounded-md bg-accent px-3 py-1.5 text-xs font-semibold text-black">
          Add sealed product
        </Link>
      </div>

      <div className="mb-6 grid grid-cols-2 gap-2 sm:grid-cols-4">
        {[
          { label: "Market value", node: <span className="text-accent">{usd(d.totals.value)}</span> },
          { label: "Cost of what you hold", node: usd(d.totals.cost) },
          { label: "Unrealized", node: <Gain value={d.totals.cost || d.totals.value ? unrealized : null} base={d.totals.cost} /> },
          { label: "Realized (sold)", node: <Gain value={d.totals.realized} /> },
        ].map((s) => (
          <div key={s.label} className="rounded-lg border border-ink-800 bg-ink-900 px-3 py-2">
            <div className="text-[10px] uppercase tracking-wider text-ink-500">{s.label}</div>
            <div className="tnum text-lg font-semibold">{s.node}</div>
          </div>
        ))}
      </div>

      {d.held.length === 0 && d.watching.length === 0 ? (
        <p className="rounded-xl border border-dashed border-ink-700 px-4 py-14 text-center text-sm text-ink-400">
          Nothing logged yet.{" "}
          <Link to="/sealed/add" className="text-accent underline">
            Add your first sealed product
          </Link>{" "}
          or watch one you're thinking of buying.
        </p>
      ) : null}

      {d.held.length ? (
        <Table title="Holding" rows={d.held} />
      ) : null}

      {d.watching.length ? (
        <section className="mt-6">
          <h2 className="mb-2 text-sm font-semibold text-ink-200">Watching</h2>
          <div className="overflow-x-auto rounded-xl border border-ink-800 bg-ink-900">
            <table className="w-full min-w-[640px] text-sm">
              <tbody>
                {d.watching.map((p) => (
                  <tr key={p.product.productId} className="border-b border-ink-850 last:border-0">
                    <td className="px-3 py-2">
                      <ProductCell p={p} />
                    </td>
                    <td className="tnum px-3 py-2 text-right text-xs">{usd(p.product.market)}</td>
                    <td className="tnum px-3 py-2 text-right text-xs" title="Change over 30 days">
                      {p.trend?.change30 != null ? (
                        <span className={p.trend.change30 >= 0 ? "text-good" : "text-rose-400"}>
                          {p.trend.change30 >= 0 ? "+" : "−"}
                          {Math.abs(p.trend.change30 * 100).toFixed(0)}% 30d
                        </span>
                      ) : (
                        <span className="text-ink-600">—</span>
                      )}
                    </td>
                    <td className="px-3 py-2">
                      <Sparkline points={p.spark} />
                    </td>
                    <td className="px-3 py-2">
                      <SignalBadge signal={p.signal} />
                    </td>
                    <td className="px-3 py-2 text-right">
                      <Form method="post">
                        <input type="hidden" name="intent" value="unwatch" />
                        <input type="hidden" name="productId" value={p.product.productId} />
                        <button className="text-[11px] text-ink-500 underline hover:text-accent">Stop watching</button>
                      </Form>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      ) : null}

      {d.closed.length ? (
        <section className="mt-6">
          <h2 className="mb-2 text-sm font-semibold text-ink-200">Sold out of</h2>
          <ul className="divide-y divide-ink-850 rounded-xl border border-ink-800 bg-ink-900 text-sm">
            {d.closed.map((p) => (
              <li key={p.product.productId} className="flex items-center gap-3 px-3 py-2">
                <ProductCell p={p} />
                <span className="ml-auto text-xs text-ink-400">{p.holding.sold} sold · </span>
                <Gain value={p.holding.realized} />
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <p className="mt-6 max-w-3xl text-[11px] leading-relaxed text-ink-500">
        Values use TCGplayer market prices, refreshed daily. Signals come from each product's own recorded prices over
        the last 90 days — where today sits between its low and high, whether it's still falling, and how far it is above
        what you paid. They explain their reasoning when you hover them, need two weeks of history, and aren't
        predictions or financial advice.
      </p>
    </>
  );
}

type Pos = Extract<Route.ComponentProps["loaderData"], { enabled: true }>["held"][number];

function ProductCell({ p }: { p: Pos }) {
  return (
    <Link to={`/sealed/${p.product.productId}`} className="flex min-w-0 items-center gap-2.5 hover:text-accent">
      {p.product.image ? <img src={p.product.image} alt="" loading="lazy" className="h-10 w-10 shrink-0 rounded object-contain" /> : null}
      <span className="min-w-0">
        <span className="block truncate font-medium">{p.product.name}</span>
        <span className="block truncate text-[11px] text-ink-500">
          {CATEGORY_LABELS[p.product.category] ?? p.product.category} · {p.product.setName}
        </span>
      </span>
    </Link>
  );
}

function Table({ title, rows }: { title: string; rows: Pos[] }) {
  return (
    <section>
      <h2 className="mb-2 text-sm font-semibold text-ink-200">{title}</h2>
      <div className="overflow-x-auto rounded-xl border border-ink-800 bg-ink-900">
        <table className="w-full min-w-[860px] text-sm">
          <thead>
            <tr className="border-b border-ink-800 text-left text-[10px] uppercase tracking-wider text-ink-400">
              <th className="px-3 py-2 font-medium">Product</th>
              <th className="px-3 py-2 text-right font-medium">Held</th>
              <th className="px-3 py-2 text-right font-medium">Avg cost</th>
              <th className="px-3 py-2 text-right font-medium">Market</th>
              <th className="px-3 py-2 text-right font-medium">Value</th>
              <th className="px-3 py-2 text-right font-medium">Unrealized</th>
              <th className="px-3 py-2 font-medium">90 days</th>
              <th className="px-3 py-2 font-medium">Signal</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((p) => (
              <tr key={p.product.productId} className="border-b border-ink-850 last:border-0 hover:bg-ink-850">
                <td className="max-w-72 px-3 py-2">
                  <ProductCell p={p} />
                </td>
                <td className="tnum px-3 py-2 text-right text-xs">{p.holding.held}</td>
                <td className="tnum px-3 py-2 text-right text-xs">{usd(p.holding.avgCost)}</td>
                <td className="tnum px-3 py-2 text-right text-xs">{usd(p.product.market)}</td>
                <td className="tnum px-3 py-2 text-right font-semibold text-accent">{usd(p.value)}</td>
                <td className="px-3 py-2 text-right text-xs">
                  <Gain value={p.unrealized} base={p.holding.costBasis} />
                </td>
                <td className="px-3 py-2">
                  <Sparkline points={p.spark} />
                </td>
                <td className="px-3 py-2">
                  <SignalBadge signal={p.signal} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
