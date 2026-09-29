import { useState } from "react";
import { useCallback, useEffect } from "react";
import { Form, Link, useFetcher, useNavigation } from "react-router";
import type { Route } from "./+types/collection";
import { Select, SearchBox, Toggle } from "@/components/controls";
import { CopyBadge, finishShort } from "@/components/finish";
import { usd } from "@/lib/format";
import { requireUser } from "@/lib/server/auth.server";
import { finishPrices, finishesFor, getCard } from "@/lib/server/catalog.server";
import {
  itemInput,
  restoreItems,
  takeItems,
  totals,
  updateItem,
  valuedCollection,
  type OwnedItem,
  type RemovedCopy,
} from "@/lib/server/collection.server";
import { CONDITIONS, GRADERS, GRADES } from "@/lib/valuation";

export const meta: Route.MetaFunction = () => [{ title: "Collection — Shadowless" }];

const SORTS = {
  value: "Value",
  recent: "Recently added",
  name: "Name",
  set: "Set & number",
  gain: "Gain",
} as const;

export async function loader({ request }: Route.LoaderArgs) {
  const user = await requireUser(request);
  const sp = new URL(request.url).searchParams;
  const q = (sp.get("q") ?? "").trim().toLowerCase();
  const kind = sp.get("kind") ?? "all";
  const sort = (sp.get("sort") ?? "value") as keyof typeof SORTS;
  const view = sp.get("view") === "grid" ? "grid" : "list";
  const all = await valuedCollection(user.id);

  let items = all.filter((i) => {
    if (q && !`${i.card?.name} ${i.card?.setName} ${i.card?.localId}`.toLowerCase().includes(q)) return false;
    if (kind === "graded" && !i.grader) return false;
    if (kind === "raw" && i.grader) return false;
    if (kind === "played" && (i.grader || i.condition === "M" || i.condition === "NM")) return false;
    return true;
  });
  const gainOf = (i: OwnedItem) => (i.unitValue != null && i.purchaseCents != null ? i.unitValue - i.purchaseCents / 100 : null);
  items = [...items].sort((a, b) => {
    switch (sort) {
      case "recent":
        return b.createdAt.localeCompare(a.createdAt);
      case "name":
        return (a.card?.name ?? "").localeCompare(b.card?.name ?? "");
      case "set":
        return (b.card?.releaseDate ?? "").localeCompare(a.card?.releaseDate ?? "") || (a.card?.numberSort ?? 0) - (b.card?.numberSort ?? 0);
      case "gain":
        return (gainOf(b) ?? -Infinity) - (gainOf(a) ?? -Infinity);
      default:
        return (b.unitValue ?? -1) * b.quantity - (a.unitValue ?? -1) * a.quantity;
    }
  });

  const prices = finishPrices([...new Set(items.map((i) => i.cardId))]);
  const finishOptions = Object.fromEntries(
    items.map((i) => [i.cardId, i.card ? finishesFor(i.card, prices.get(i.cardId)) : [i.finish]]),
  );
  return { items, all: totals(all), shown: totals(items), q, kind, sort, view, finishOptions };
}

export async function action({ request }: Route.ActionArgs) {
  const user = await requireUser(request);
  const form = await request.formData();
  const intent = String(form.get("intent"));
  const id = String(form.get("id") ?? "");
  if (intent === "remove") {
    const ids = form.getAll("id").map(String).filter(Boolean);
    const removed = await takeItems(user.id, ids, form.get("mode") === "one" ? "one" : "all");
    return { removed, at: Date.now() };
  }
  if (intent === "restore") {
    let copies: unknown = null;
    try {
      copies = JSON.parse(String(form.get("copies") ?? "null"));
    } catch {
      return { error: "Couldn't undo that." };
    }
    return { restored: await restoreItems(user.id, copies) };
  }
  if (intent === "update") {
    const parsed = itemInput.safeParse(Object.fromEntries([...form.entries()].filter(([, v]) => v !== "")));
    if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Check the form.", id };
    const card = getCard(parsed.data.cardId);
    if (!card || !finishesFor(card, finishPrices([card.id]).get(card.id)).includes(parsed.data.finish)) {
      return { error: "That printing doesn't exist for this card.", id };
    }
    await updateItem(user.id, id, parsed.data);
    return { ok: true };
  }
  return { error: "Unknown request." };
}

export default function Collection({ loaderData, actionData }: Route.ComponentProps) {
  const { items, all, shown, q, kind, sort, view, finishOptions } = loaderData;
  const [editing, setEditing] = useState<string | null>(null);
  const [selecting, setSelecting] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const remover = useFetcher<typeof action>();
  const busy = remover.state !== "idle";

  const remove = (ids: string[], mode: "one" | "all") => {
    const form = new FormData();
    form.set("intent", "remove");
    form.set("mode", mode);
    ids.forEach((id) => form.append("id", id));
    void remover.submit(form, { method: "post" });
    setEditing(null);
  };
  const toggle = (id: string) =>
    setSelected((cur) => {
      const next = new Set(cur);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  const stopSelecting = () => {
    setSelecting(false);
    setSelected(new Set());
  };
  // Tapping a card edits it, or picks it while selecting.
  const open = (id: string) => (selecting ? toggle(id) : setEditing(id));
  const removedData = remover.data?.removed && remover.data.at ? { removed: remover.data.removed, at: remover.data.at } : null;
  const selectedCopies = items.filter((i) => selected.has(i.id)).reduce((n, i) => n + i.quantity, 0);
  const editor = (i: OwnedItem) => (
    <EditRow
      item={i}
      finishes={finishOptions[i.cardId] ?? [i.finish]}
      error={actionData && "id" in actionData && actionData.id === i.id ? actionData.error : undefined}
      onClose={() => setEditing(null)}
      onRemove={() => remove([i.id], "all")}
    />
  );

  return (
    <>
      <div className="mb-4 flex flex-wrap items-end gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Collection</h1>
          <p className="mt-1 text-sm text-ink-400">
            {all.copies.toLocaleString()} cards · {usd(all.value)}
            {shown.copies !== all.copies ? ` · showing ${shown.copies.toLocaleString()} (${usd(shown.value)})` : ""}
          </p>
        </div>
        <div className="ml-auto flex gap-2 text-xs">
          <Link to="/add" className="rounded-md bg-accent px-3 py-1.5 font-semibold text-black">
            Add cards
          </Link>
          <a href="/export/csv" className="rounded-md border border-ink-700 px-3 py-1.5 text-ink-200 hover:border-accent">
            Export CSV
          </a>
        </div>
      </div>

      <div className="mb-4 flex flex-wrap items-center gap-2">
        <SearchBox name="q" placeholder="Filter by name, set, number…" value={q} />
        <Toggle
          name="kind"
          value={kind}
          options={[
            { value: "all", label: "All" },
            { value: "raw", label: "Raw" },
            { value: "graded", label: "Graded" },
            { value: "played", label: "Played" },
          ]}
        />
        <Select name="sort" label="Sort" value={sort} options={Object.entries(SORTS).map(([value, label]) => ({ value, label }))} />
        <div className="ml-auto flex items-center gap-2">
          {items.length ? (
            <button
              onClick={() => (selecting ? stopSelecting() : setSelecting(true))}
              className={`rounded-md border px-2.5 py-1.5 text-xs ${selecting ? "border-accent text-accent" : "border-ink-700 text-ink-300 hover:border-ink-600"}`}
            >
              {selecting ? "Cancel" : "Select"}
            </button>
          ) : null}
          <Toggle
            name="view"
            value={view}
            options={[
              { value: "list", label: "List" },
              { value: "grid", label: "Cards" },
            ]}
          />
        </div>
      </div>

      {items.length === 0 ? (
        <p className="rounded-xl border border-dashed border-ink-700 px-4 py-14 text-center text-sm text-ink-400">
          {all.copies ? "Nothing matches those filters." : "No cards yet — add some to get started."}
        </p>
      ) : view === "grid" ? (
        <div className="grid grid-cols-3 gap-x-3 gap-y-4 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-7">
          {items.map((i) =>
            editing === i.id ? (
              <div key={i.id} className="col-span-3 rounded-xl border border-accent/40 bg-ink-900 p-3 sm:col-span-4 md:col-span-5 lg:col-span-7">
                {editor(i)}
              </div>
            ) : (
              <button key={i.id} onClick={() => open(i.id)} className="group flex flex-col text-left" title={selecting ? "Select" : "Edit"}>
                <span
                  className={`relative block overflow-hidden rounded-lg bg-ink-850 ring-1 transition group-hover:-translate-y-0.5 group-hover:ring-accent ${
                    selected.has(i.id) ? "ring-2 ring-accent" : "ring-ink-800"
                  }`}
                >
                  {selecting ? <Check on={selected.has(i.id)} className="absolute left-1 top-1 z-10" /> : null}
                  {i.card?.image ? (
                    <img src={i.card.image} alt={i.card.name} loading="lazy" className="aspect-[245/342] w-full object-cover" />
                  ) : (
                    <span className="grid aspect-[245/342] place-items-center px-2 text-center text-[10px] text-ink-500">{i.card?.name ?? i.cardId}</span>
                  )}
                  {i.quantity > 1 ? (
                    <span className="absolute right-1 top-1 rounded bg-ink-950/85 px-1.5 py-0.5 text-[10px] font-bold text-ink-100">×{i.quantity}</span>
                  ) : null}
                </span>
                <span className="mt-1.5 flex items-baseline justify-between gap-1 px-0.5">
                  <span className="truncate text-[11px] text-ink-200">{i.card?.name ?? i.cardId}</span>
                  <span className="tnum shrink-0 text-[11px] font-semibold text-accent">
                    {i.unitValue != null ? usd(i.unitValue * i.quantity, { compact: true }) : "—"}
                  </span>
                </span>
                <span className="flex items-center gap-1 px-0.5 text-[10px] text-ink-500">
                  {finishShort(i.finish)} <CopyBadge {...i} />
                </span>
              </button>
            ),
          )}
        </div>
      ) : (
        <>
          {/* Phones: one compact row per copy, value always visible. */}
          <ul className="divide-y divide-ink-850 overflow-hidden rounded-xl border border-ink-800 bg-ink-900 md:hidden">
            {items.map((i) => (
              <li key={i.id}>
                {editing === i.id ? (
                  <div className="bg-ink-850 p-3">{editor(i)}</div>
                ) : (
                  <div className="flex items-center">
                  <button onClick={() => open(i.id)} className="flex min-w-0 flex-1 items-center gap-3 py-2.5 pl-3 text-left active:bg-ink-850">
                    {selecting ? <Check on={selected.has(i.id)} /> : null}
                    {i.card?.image ? <img src={i.card.image} alt="" loading="lazy" className="h-14 w-auto shrink-0 rounded-sm ring-1 ring-ink-700" /> : null}
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium">
                        {i.card?.name ?? i.cardId}
                        {i.quantity > 1 ? <span className="ml-1 text-ink-400">×{i.quantity}</span> : null}
                      </span>
                      <span className="block truncate text-[11px] text-ink-500">
                        {i.card?.setName} · {i.card?.localId}
                      </span>
                      <span className="mt-1 flex items-center gap-1.5 text-[10px] text-ink-400">
                        {finishShort(i.finish)} <CopyBadge {...i} />
                      </span>
                    </span>
                    <span className="shrink-0 text-right">
                      <span className="tnum block text-sm font-semibold text-accent">{i.unitValue != null ? usd(i.unitValue * i.quantity) : "—"}</span>
                      {i.purchaseCents != null ? (
                        <span className="tnum block text-[10px] text-ink-500">paid {usd((i.purchaseCents / 100) * i.quantity)}</span>
                      ) : null}
                    </span>
                  </button>
                  {!selecting ? <RemoveOne quantity={i.quantity} disabled={busy} onClick={() => remove([i.id], "one")} /> : null}
                  </div>
                )}
              </li>
            ))}
          </ul>
          <div className="hidden overflow-x-auto rounded-xl border border-ink-800 bg-ink-900 md:block">
            <table className="w-full min-w-[760px] text-sm">
              <thead>
                <tr className="border-b border-ink-800 text-left text-[10px] uppercase tracking-wider text-ink-400">
                  <th className="px-3 py-2 font-medium">Card</th>
                  <th className="px-3 py-2 font-medium">Printing</th>
                  <th className="px-3 py-2 font-medium">Copy</th>
                  <th className="px-3 py-2 text-right font-medium">Qty</th>
                  <th className="px-3 py-2 text-right font-medium">Each</th>
                  <th className="px-3 py-2 text-right font-medium">Total</th>
                  <th className="px-3 py-2 text-right font-medium">Paid</th>
                  <th className="px-3 py-2" />
                </tr>
              </thead>
              <tbody>
                {items.map((i) =>
                  editing === i.id ? (
                    <tr key={i.id} className="border-b border-ink-850 bg-ink-850">
                      <td colSpan={8} className="p-3">
                        {editor(i)}
                      </td>
                    </tr>
                  ) : (
                    <tr
                      key={i.id}
                      onClick={() => open(i.id)}
                      className={`cursor-pointer border-b border-ink-850 last:border-0 hover:bg-ink-850 ${selected.has(i.id) ? "bg-accent/5" : ""}`}
                    >
                      <td className="px-3 py-2">
                        <div className="flex items-center gap-2.5">
                          {selecting ? <Check on={selected.has(i.id)} /> : null}
                          {i.card?.image ? <img src={i.card.image} alt="" loading="lazy" className="h-12 w-auto rounded-sm ring-1 ring-ink-700" /> : null}
                          <div className="min-w-0">
                            <div className="truncate font-medium">{i.card?.name ?? i.cardId}</div>
                            <div className="truncate text-[11px] text-ink-500">
                              {i.card?.setName} · {i.card?.localId}
                            </div>
                          </div>
                        </div>
                      </td>
                      <td className="px-3 py-2 text-xs text-ink-300">{finishShort(i.finish)}</td>
                      <td className="px-3 py-2">
                        <CopyBadge {...i} />
                      </td>
                      <td className="tnum px-3 py-2 text-right text-xs">{i.quantity}</td>
                      <td className="tnum px-3 py-2 text-right text-xs" title={i.valueSource === "override" ? "Your own value" : i.estimate ? "Market price with an estimated condition discount" : undefined}>
                        {usd(i.unitValue)}
                        {i.valueSource === "override" ? <span className="text-ink-500">*</span> : i.estimate ? <span className="text-ink-500">~</span> : null}
                      </td>
                      <td className="tnum px-3 py-2 text-right font-semibold text-accent">
                        {i.unitValue != null ? usd(i.unitValue * i.quantity) : "—"}
                      </td>
                      <td className="tnum px-3 py-2 text-right text-xs text-ink-400">{i.purchaseCents != null ? usd(i.purchaseCents / 100) : "—"}</td>
                      <td className="px-3 py-2 text-right">
                        {selecting ? null : (
                          <span className="flex items-center justify-end gap-2">
                            <span className="text-xs text-ink-400 underline">Edit</span>
                            <RemoveOne quantity={i.quantity} disabled={busy} onClick={() => remove([i.id], "one")} />
                          </span>
                        )}
                      </td>
                    </tr>
                  ),
                )}
              </tbody>
            </table>
          </div>
        </>
      )}
      {selecting ? (
        <div className="fixed inset-x-0 bottom-16 z-40 mx-auto flex w-[min(34rem,calc(100%-1.5rem))] items-center gap-2 rounded-xl border border-ink-700 bg-ink-850 px-3 py-2.5 text-sm shadow-2xl md:bottom-4">
          <span className="text-ink-200">
            {selected.size ? `${selected.size} selected${selectedCopies !== selected.size ? ` (${selectedCopies} cards)` : ""}` : "Tap cards to select"}
          </span>
          <button onClick={() => setSelected(new Set(items.map((i) => i.id)))} className="text-xs text-ink-400 underline">
            All {items.length}
          </button>
          <button
            disabled={!selected.size || busy}
            onClick={() => {
              remove([...selected], "all");
              stopSelecting();
            }}
            className="ml-auto rounded-md bg-rose-500 px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-40"
          >
            Remove
          </button>
        </div>
      ) : null}
      <RemovedToast key={removedData?.at ?? 0} data={removedData} />
      <p className="mt-3 text-[11px] text-ink-500">
        ~ played-condition value, estimated from typical TCGplayer discounts on the Near Mint price. * your own value.
        Slabs use PSA sold prices when comps exist, otherwise the raw price.
      </p>
    </>
  );
}

function EditRow({
  item,
  finishes,
  error,
  onClose,
  onRemove,
}: {
  item: OwnedItem;
  finishes: string[];
  error?: string;
  onClose: () => void;
  onRemove: () => void;
}) {
  const [graded, setGraded] = useState(!!item.grader);
  const busy = useNavigation().state !== "idle";
  const field = "rounded-md border border-ink-700 bg-ink-900 px-2 py-1 text-xs";
  return (
    <Form method="post" onSubmit={() => setTimeout(onClose, 0)} className="flex flex-wrap items-end gap-3">
      <input type="hidden" name="id" value={item.id} />
      <input type="hidden" name="cardId" value={item.cardId} />
      <div className="w-full text-sm font-semibold">
        {item.card?.name} <span className="font-normal text-ink-500">· {item.card?.setName}</span>
      </div>
      <Labeled label="Printing">
        <select name="finish" defaultValue={item.finish} className={field}>
          {[...new Set([item.finish, ...finishes])].map((f) => (
            <option key={f} value={f}>
              {f}
            </option>
          ))}
        </select>
      </Labeled>
      <Labeled label={<button type="button" onClick={() => setGraded((g) => !g)} className="underline">{graded ? "Graded ↔ raw" : "Raw ↔ graded"}</button>}>
        {graded ? (
          <span className="flex gap-1">
            <select name="grader" defaultValue={item.grader ?? "PSA"} className={field}>
              {GRADERS.map((g) => (
                <option key={g}>{g}</option>
              ))}
            </select>
            <select name="grade" defaultValue={item.grade != null ? String(Number(item.grade)) : "10"} className={field}>
              {GRADES.map((g) => (
                <option key={g} value={g}>
                  {g}
                </option>
              ))}
            </select>
            <input name="certNumber" defaultValue={item.certNumber ?? ""} placeholder="Cert #" maxLength={40} className={`${field} w-28`} />
          </span>
        ) : (
          <select name="condition" defaultValue={item.condition ?? "NM"} className={field}>
            {CONDITIONS.map((c) => (
              <option key={c.code} value={c.code}>
                {c.label}
              </option>
            ))}
          </select>
        )}
      </Labeled>
      <Labeled label="Qty">
        <input name="quantity" type="number" min={1} max={999} defaultValue={item.quantity} className={`${field} w-16`} />
      </Labeled>
      <Labeled label="Paid each">
        <input name="purchase" inputMode="decimal" defaultValue={item.purchaseCents != null ? (item.purchaseCents / 100).toFixed(2) : ""} className={`${field} w-20`} />
      </Labeled>
      <Labeled label="Your value (optional)">
        <input name="valueOverride" inputMode="decimal" defaultValue={item.valueOverrideCents != null ? (item.valueOverrideCents / 100).toFixed(2) : ""} placeholder={item.unitValue?.toFixed(2)} className={`${field} w-24`} />
      </Labeled>
      <Labeled label="Acquired">
        <input name="acquiredOn" type="date" defaultValue={item.acquiredOn ?? ""} className={field} />
      </Labeled>
      <Labeled label="Notes">
        <input name="notes" defaultValue={item.notes ?? ""} maxLength={500} className={`${field} w-48`} />
      </Labeled>
      <div className="ml-auto flex items-center gap-2">
        {error ? <span className="text-xs text-rose-300">{error}</span> : null}
        <button type="button" onClick={onClose} className="px-2 text-xs text-ink-400">
          Cancel
        </button>
        <button name="intent" value="update" disabled={busy} className="rounded-md bg-accent px-3 py-1.5 text-xs font-semibold text-black">
          Save
        </button>
      </div>
      <div className="w-full">
        <button type="button" onClick={onRemove} className="text-[11px] text-rose-300 underline">
          Remove {item.quantity > 1 ? `all ${item.quantity} copies` : "from collection"}
        </button>
      </div>
    </Form>
  );
}

function Labeled({ label, children }: { label: React.ReactNode; children: React.ReactNode }) {
  return (
    <label className="text-[10px] uppercase tracking-wider text-ink-500">
      <span className="mb-1 block">{label}</span>
      {children}
    </label>
  );
}

function Check({ on, className = "" }: { on: boolean; className?: string }) {
  return (
    <span
      aria-hidden
      className={`grid h-5 w-5 shrink-0 place-items-center rounded border text-[11px] font-bold ${
        on ? "border-accent bg-accent text-black" : "border-ink-500 bg-ink-950/70"
      } ${className}`}
    >
      {on ? "✓" : ""}
    </span>
  );
}

/** Takes one copy off (the row goes at zero). Undo is in the toast. */
function RemoveOne({ quantity, disabled, onClick }: { quantity: number; disabled: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={(e) => {
        e.stopPropagation();
        onClick();
      }}
      title={quantity > 1 ? "Remove one copy" : "Remove"}
      aria-label={quantity > 1 ? "Remove one copy" : "Remove"}
      className="grid h-10 w-10 shrink-0 place-items-center text-ink-500 hover:text-rose-300 disabled:opacity-40 md:h-7 md:w-7"
    >
      {quantity > 1 ? (
        <span className="text-base leading-none">−</span>
      ) : (
        <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
          <path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3" />
        </svg>
      )}
    </button>
  );
}

/** "Removed 3 cards — Undo", gone after a few seconds. */
function RemovedToast({ data }: { data: { removed: RemovedCopy[]; at: number } | null }) {
  const undo = useFetcher();
  const [closedAt, setClosedAt] = useState(0);
  const close = useCallback(() => setClosedAt(Date.now()), []);
  const show = data && data.removed.length && data.at > closedAt && undo.state === "idle" && !undo.data;
  useEffect(() => {
    if (!show) return;
    const t = setTimeout(close, 7000);
    return () => clearTimeout(t);
  }, [show, close]);
  if (!show || !data) return null;
  const copies = data.removed.reduce((n, c) => n + Number(c.quantity ?? 1), 0);
  return (
    <div role="status" className="fixed bottom-20 left-1/2 z-50 flex -translate-x-1/2 items-center gap-3 whitespace-nowrap rounded-lg border border-ink-700 bg-ink-850 px-4 py-2.5 text-sm shadow-xl md:bottom-4">
      <span>
        Removed {copies === 1 ? "1 card" : `${copies} cards`}
      </span>
      <undo.Form method="post">
        <input type="hidden" name="intent" value="restore" />
        <input type="hidden" name="copies" value={JSON.stringify(data.removed)} />
        <button className="text-xs font-semibold text-accent underline">Undo</button>
      </undo.Form>
    </div>
  );
}
