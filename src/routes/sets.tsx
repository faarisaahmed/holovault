import { Form, Link } from "react-router";
import type { Route } from "./+types/sets";
import { ProgressBar } from "@/components/checklist";
import { usd } from "@/lib/format";
import { requireUser } from "@/lib/server/auth.server";
import { listSets } from "@/lib/server/catalog.server";
import { mySets, setGoal } from "@/lib/server/progress.server";

export const meta: Route.MetaFunction = () => [{ title: "Sets — Card Tracker" }];

export async function loader({ request }: Route.LoaderArgs) {
  const user = await requireUser(request);
  const rows = await mySets(user.id);
  rows.sort((a, b) => Number(b.tracked) - Number(a.tracked) || b.base.pct - a.base.pct);
  const mine = new Set(rows.map((r) => r.set.id));
  return {
    rows,
    others: listSets()
      .filter((s) => !mine.has(s.id))
      .map((s) => ({ id: s.id, name: s.name, region: s.region, releaseDate: s.releaseDate })),
  };
}

export async function action({ request }: Route.ActionArgs) {
  const user = await requireUser(request);
  const form = await request.formData();
  const setId = String(form.get("setId") ?? "");
  if (setId) await setGoal(user.id, "set", setId, form.get("on") === "1");
  return { ok: true };
}

export default function Sets({ loaderData }: Route.ComponentProps) {
  const { rows, others } = loaderData;
  return (
    <>
      <div className="mb-4">
        <h1 className="text-2xl font-semibold tracking-tight">Sets</h1>
        <p className="mt-1 max-w-3xl text-sm text-ink-400">
          Every set you own a card from, plus any you track. <strong className="text-ink-300">Set</strong> counts one of
          each card; <strong className="text-ink-300">master</strong> counts every printing (reverse holos, 1st
          Editions…). Open a set to see what's missing and check cards off.
        </p>
      </div>

      <Form method="post" className="mb-5 flex flex-wrap items-center gap-2">
        <input type="hidden" name="on" value="1" />
        <select name="setId" required className="max-w-xs rounded-md border border-ink-700 bg-ink-850 px-2 py-1.5 text-xs">
          <option value="">Track another set…</option>
          {others.map((s) => (
            <option key={s.id} value={s.id}>
              {s.region === "ja" ? "🇯🇵 " : ""}
              {s.name} ({s.releaseDate?.slice(0, 4)})
            </option>
          ))}
        </select>
        <button className="rounded-md border border-ink-700 px-3 py-1.5 text-xs hover:border-accent">Track</button>
      </Form>

      {rows.length === 0 ? (
        <p className="rounded-xl border border-dashed border-ink-700 px-4 py-14 text-center text-sm text-ink-400">
          Add a card or track a set to see progress here.
        </p>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {rows.map((r) => (
            <Link key={r.set.id} to={`/sets/${encodeURIComponent(r.set.id)}`} className="rounded-xl border border-ink-800 bg-ink-900 p-3 transition-colors hover:border-ink-600">
              <div className="flex items-center gap-3">
                <div className="grid h-10 w-20 shrink-0 place-items-center">
                  {r.set.logo ? <img src={r.set.logo} alt="" className="max-h-10 w-auto max-w-full object-contain" /> : <span className="text-xs font-black text-ink-600">{r.set.abbreviation}</span>}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-semibold">{r.set.name}</div>
                  <div className="text-[10px] text-ink-500">
                    {r.set.releaseDate?.slice(0, 4)} {r.tracked ? "· tracked" : ""}
                  </div>
                </div>
              </div>
              <div className="mt-3 space-y-2 text-[11px]">
                <div>
                  <div className="flex justify-between text-ink-300">
                    <span>Set</span>
                    <span className="tnum">
                      {r.base.have}/{r.base.total} · {Math.round(r.base.pct * 100)}%
                    </span>
                  </div>
                  <ProgressBar pct={r.base.pct} />
                </div>
                <div>
                  <div className="flex justify-between text-ink-300">
                    <span>Master</span>
                    <span className="tnum">
                      {r.master.have}/{r.master.total} · {Math.round(r.master.pct * 100)}%
                    </span>
                  </div>
                  <ProgressBar pct={r.master.pct} tone="bg-accent" />
                </div>
                <div className="text-ink-500">
                  {r.base.have < r.base.total ? `${usd(r.base.costToComplete)} to finish the set` : "Set complete!"}
                </div>
              </div>
            </Link>
          ))}
        </div>
      )}
    </>
  );
}
