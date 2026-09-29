import { Link } from "react-router";
import type { Route } from "./+types/grading";
import { Toggle } from "@/components/controls";
import { CopyBadge, finishShort } from "@/components/finish";
import { usd } from "@/lib/format";
import { requireUser } from "@/lib/server/auth.server";
import { getSettings, valuedCollection } from "@/lib/server/collection.server";
import { gradedPrices, gradedSourceConfigured, refreshGraded } from "@/lib/server/graded.server";
import { gradingCall, type GradingVerdict } from "@/lib/valuation";

export const meta: Route.MetaFunction = () => [{ title: "Grading — Shadowless" }];

const ORDER: Record<GradingVerdict, number> = { grade: 0, maybe: 1, unknown: 2, no: 3 };

export async function loader({ request }: Route.LoaderArgs) {
  const user = await requireUser(request);
  const settings = await getSettings(user.id);
  const cost = (settings.gradingFeeCents + settings.gradingShippingCents) / 100;
  const show = new URL(request.url).searchParams.get("show") ?? "worth";

  const raw = (await valuedCollection(user.id)).filter(
    (i) => !i.grader && (i.condition === "M" || i.condition === "NM") && i.unitValue != null && i.card,
  );
  // Look up comps for the most valuable cards first, a few per visit.
  const byValue = [...raw].sort((a, b) => b.unitValue! - a.unitValue!);
  const looked = await refreshGraded(byValue.map((i) => i.cardId), 6);
  const comps = await gradedPrices(raw.map((i) => i.cardId));

  const rows = byValue
    .map((i) => {
      const psa = comps.get(i.cardId);
      const call = gradingCall({ rawValue: i.unitValue!, psa9: psa?.get("9"), psa10: psa?.get("10"), cost });
      const q = encodeURIComponent(`${i.card!.name} ${i.card!.localId} ${i.card!.setName} PSA`);
      return {
        id: i.id,
        name: i.card!.name,
        setName: i.card!.setName,
        localId: i.card!.localId,
        image: i.card!.image,
        finish: i.finish,
        condition: i.condition,
        quantity: i.quantity,
        raw: i.unitValue!,
        psa9: psa?.get("9") ?? null,
        psa10: psa?.get("10") ?? null,
        ...call,
        soldUrl: `https://www.ebay.com/sch/i.html?_nkw=${q}&LH_Sold=1&LH_Complete=1`,
      };
    })
    .filter((r) => (show === "worth" ? r.verdict === "grade" || r.verdict === "maybe" || (r.verdict === "unknown" && r.raw * 2 >= r.breakEven) : true))
    .sort((a, b) => ORDER[a.verdict] - ORDER[b.verdict] || (b.gain9 ?? b.gain10 ?? -b.breakEven) - (a.gain9 ?? a.gain10 ?? -a.breakEven));

  return {
    rows,
    cost,
    show,
    compsConfigured: gradedSourceConfigured(),
    stillLooking: Math.max(0, byValue.length - looked),
    totalRaw: raw.length,
  };
}

const VERDICT: Record<GradingVerdict, { label: string; tone: string }> = {
  grade: { label: "Grade it", tone: "bg-good/15 text-good ring-good/30" },
  maybe: { label: "Only if it 10s", tone: "bg-amber-400/10 text-amber-300 ring-amber-400/30" },
  no: { label: "Not worth it", tone: "bg-ink-800 text-ink-400 ring-ink-700" },
  unknown: { label: "No comps yet", tone: "bg-ink-800 text-ink-300 ring-ink-700" },
};

export default function Grading({ loaderData: d }: Route.ComponentProps) {
  return (
    <>
      <div className="mb-4">
        <h1 className="text-2xl font-semibold tracking-tight">Worth grading?</h1>
        <p className="mt-1 max-w-3xl text-sm text-ink-400">
          Your raw Mint and Near Mint cards, checked against what PSA 9s and 10s actually sell for. A card is worth
          grading when even a <strong className="text-ink-200">PSA 9</strong> sells for more than the raw card plus{" "}
          <strong className="text-ink-200">{usd(d.cost)}</strong> in grading and shipping (
          <Link to="/settings" className="text-accent underline">
            change
          </Link>
          ). If only a 10 would pay off, it's a gamble — most cards don't come back 10s.
        </p>
      </div>
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <Toggle name="show" value={d.show} options={[{ value: "worth", label: "Worth a look" }, { value: "all", label: `All ${d.totalRaw} Mint / NM` }]} />
        {!d.compsConfigured ? (
          <span className="text-[11px] text-ink-500">Graded sold prices aren't connected on this server, so cards show break-even prices instead.</span>
        ) : null}
      </div>

      {d.rows.length === 0 ? (
        <p className="rounded-xl border border-dashed border-ink-700 px-4 py-14 text-center text-sm text-ink-400">
          {d.totalRaw ? "Nothing looks worth grading right now." : "No raw Mint or Near Mint cards in your collection yet."}
        </p>
      ) : (
        <>
        {/* Phones: one card per row, verdict and the numbers that drive it. */}
        <ul className="divide-y divide-ink-850 overflow-hidden rounded-xl border border-ink-800 bg-ink-900 md:hidden">
          {d.rows.map((r) => (
            <li key={r.id} className="flex gap-3 px-3 py-2.5">
              {r.image ? <img src={r.image} alt="" loading="lazy" className="h-16 w-auto shrink-0 rounded-sm" /> : null}
              <div className="min-w-0 flex-1">
                <div className="flex items-start gap-2">
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-medium">{r.name}</div>
                    <div className="truncate text-[11px] text-ink-500">
                      {r.setName} · {r.localId} · {finishShort(r.finish)}
                      {r.quantity > 1 ? ` ×${r.quantity}` : ""}
                    </div>
                  </div>
                  <span className={`shrink-0 rounded px-2 py-0.5 text-[10px] font-semibold ring-1 ${VERDICT[r.verdict].tone}`}>{VERDICT[r.verdict].label}</span>
                </div>
                <dl className="tnum mt-1.5 grid grid-cols-4 gap-1 text-[11px]">
                  {[
                    ["Raw", usd(r.raw)],
                    ["PSA 9", usd(r.psa9)],
                    ["PSA 10", usd(r.psa10)],
                    ["Break-even", usd(r.breakEven)],
                  ].map(([k, v]) => (
                    <div key={k}>
                      <dt className="text-[9px] uppercase tracking-wider text-ink-500">{k}</dt>
                      <dd className="text-ink-200">{v}</dd>
                    </div>
                  ))}
                </dl>
                <a href={r.soldUrl} target="_blank" rel="noreferrer noopener" className="mt-1 inline-block text-[11px] text-ink-400 underline">
                  Sold listings
                </a>
              </div>
            </li>
          ))}
        </ul>
        <div className="hidden overflow-x-auto rounded-xl border border-ink-800 bg-ink-900 md:block">
          <table className="w-full min-w-[820px] text-sm">
            <thead>
              <tr className="border-b border-ink-800 text-left text-[10px] uppercase tracking-wider text-ink-400">
                <th className="px-3 py-2 font-medium">Card</th>
                <th className="px-3 py-2 text-right font-medium">Raw</th>
                <th className="px-3 py-2 text-right font-medium">PSA 9</th>
                <th className="px-3 py-2 text-right font-medium">PSA 10</th>
                <th className="px-3 py-2 text-right font-medium" title="Raw value plus grading and shipping">Break-even</th>
                <th className="px-3 py-2 font-medium">Verdict</th>
                <th className="px-3 py-2" />
              </tr>
            </thead>
            <tbody>
              {d.rows.map((r) => (
                <tr key={r.id} className="border-b border-ink-850 last:border-0">
                  <td className="px-3 py-2">
                    <div className="flex items-center gap-2.5">
                      {r.image ? <img src={r.image} alt="" loading="lazy" className="h-12 w-auto rounded-sm" /> : null}
                      <div className="min-w-0">
                        <div className="truncate font-medium">{r.name}</div>
                        <div className="flex items-center gap-1 text-[11px] text-ink-500">
                          {r.setName} · {r.localId} · {finishShort(r.finish)} <CopyBadge condition={r.condition} grader={null} grade={null} />
                          {r.quantity > 1 ? ` ×${r.quantity}` : ""}
                        </div>
                      </div>
                    </div>
                  </td>
                  <td className="tnum px-3 py-2 text-right text-xs">{usd(r.raw)}</td>
                  <td className="tnum px-3 py-2 text-right text-xs">
                    {usd(r.psa9)}
                    {r.gain9 != null ? <span className={`block text-[10px] ${r.gain9 > 0 ? "text-good" : "text-ink-500"}`}>{r.gain9 > 0 ? "+" : "−"}{usd(Math.abs(r.gain9))}</span> : null}
                  </td>
                  <td className="tnum px-3 py-2 text-right text-xs">
                    {usd(r.psa10)}
                    {r.gain10 != null ? <span className={`block text-[10px] ${r.gain10 > 0 ? "text-good" : "text-ink-500"}`}>{r.gain10 > 0 ? "+" : "−"}{usd(Math.abs(r.gain10))}</span> : null}
                  </td>
                  <td className="tnum px-3 py-2 text-right text-xs text-ink-300">{usd(r.breakEven)}</td>
                  <td className="px-3 py-2">
                    <span className={`rounded px-2 py-0.5 text-[11px] font-semibold ring-1 ${VERDICT[r.verdict].tone}`}>{VERDICT[r.verdict].label}</span>
                  </td>
                  <td className="px-3 py-2 text-right">
                    <a href={r.soldUrl} target="_blank" rel="noreferrer noopener" className="text-[11px] text-ink-400 underline hover:text-accent">
                      Sold listings
                    </a>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        </>
      )}
      <p className="mt-3 max-w-3xl text-[11px] leading-relaxed text-ink-500">
        Graded prices are averages of recent eBay sold listings, refreshed weekly
        {d.stillLooking ? `; comps for your other cards are being looked up a few at a time as you visit` : ""}.
        Grading only makes sense for cards that are genuinely Mint: centring, corners, edges and surface all count.
        This is a guide, not a guarantee.
      </p>
    </>
  );
}
