import { useState } from "react";
import { Form, Link, useNavigation } from "react-router";
import type { Route } from "./+types/import";
import { requireUser } from "@/lib/server/auth.server";
import { addItem, getSettings } from "@/lib/server/collection.server";
import { MAX_BYTES, previewImport } from "@/lib/server/import.server";

export const meta: Route.MetaFunction = () => [{ title: "Import — Holovault" }];

export async function loader({ request }: Route.LoaderArgs) {
  await requireUser(request);
  return {};
}

export async function action({ request }: Route.ActionArgs) {
  const user = await requireUser(request);
  const form = await request.formData();
  const file = form.get("file");
  let text = String(form.get("text") ?? "");
  if (file instanceof File && file.size > 0) {
    if (file.size > MAX_BYTES) return { error: "That file is over 2 MB. Split it into smaller files." };
    text = await file.text();
  }
  if (text.length > MAX_BYTES) return { error: "That's over 2 MB. Split it into smaller pieces." };
  if (!text.trim()) return { error: "Choose a file or paste some rows first." };

  const settings = await getSettings(user.id);
  const preview = previewImport(text, settings.defaultRegion, settings.defaultCondition);
  if ("error" in preview && preview.error) return { error: preview.error };

  if (form.get("intent") === "import") {
    let copies = 0;
    for (const r of preview.rows) {
      if (!r.input) continue;
      await addItem(user.id, r.input);
      copies += r.input.quantity;
    }
    return { done: { copies, skipped: preview.rows.filter((r) => !r.input).length } };
  }
  return {
    text,
    matched: preview.rows.filter((r) => r.input).length,
    unmatched: preview.rows.filter((r) => !r.input),
    sample: preview.rows.filter((r) => r.input).slice(0, 25),
    notes: preview.rows.filter((r) => r.input && r.problem).slice(0, 25),
    total: preview.rows.length,
    truncated: preview.truncated,
    columns: Object.keys(preview.columns),
  };
}

export default function Import({ actionData }: Route.ComponentProps) {
  const busy = useNavigation().state !== "idle";
  const [paste, setPaste] = useState(false);
  const a = actionData as
    | { error?: string; done?: { copies: number; skipped: number }; text?: string; matched?: number; total?: number; truncated?: boolean; columns?: string[]; unmatched?: { line: number; label: string; problem?: string }[]; sample?: { line: number; matched: string | null }[]; notes?: { line: number; matched: string | null; problem?: string }[] }
    | undefined;

  if (a?.done) {
    return (
      <div className="mx-auto max-w-xl py-12 text-center">
        <h1 className="text-2xl font-semibold tracking-tight">Imported {a.done.copies.toLocaleString()} cards</h1>
        <p className="mt-2 text-sm text-ink-400">{a.done.skipped ? `${a.done.skipped} rows couldn't be matched and were skipped.` : "Every row matched."}</p>
        <Link to="/collection" className="mt-5 inline-block rounded-md bg-accent px-4 py-2 text-sm font-semibold text-black">
          See your collection
        </Link>
      </div>
    );
  }

  return (
    <>
      <div className="mb-4">
        <h1 className="text-2xl font-semibold tracking-tight">Import a spreadsheet</h1>
        <p className="mt-1 max-w-3xl text-sm text-ink-400">
          A quicker way to add cards you already have listed somewhere. Upload a CSV — your own spreadsheet or an export
          from another app — with a column for the card name, the set and number, or a TCGplayer product ID. Quantity,
          condition, printing, grade and price paid are picked up if they're there. You'll see a preview before
          anything is added.
        </p>
      </div>

      {!a?.text ? (
        <Form method="post" encType="multipart/form-data" className="max-w-xl space-y-3 rounded-xl border border-ink-800 bg-ink-900 p-4">
          <input type="hidden" name="intent" value="preview" />
          {paste ? (
            <textarea name="text" rows={10} placeholder={"Name,Set,Number,Quantity,Condition\nCharizard ex,151,199,1,Near Mint"} className="w-full rounded-md border border-ink-700 bg-ink-850 p-2 font-mono text-xs" />
          ) : (
            <input name="file" type="file" accept=".csv,.tsv,.txt,text/csv" className="block w-full text-xs file:mr-3 file:rounded-md file:border-0 file:bg-accent file:px-3 file:py-1.5 file:text-xs file:font-semibold file:text-black" />
          )}
          <div className="flex items-center gap-3">
            <button disabled={busy} className="rounded-md bg-accent px-4 py-1.5 text-sm font-semibold text-black disabled:opacity-50">
              {busy ? "Reading…" : "Preview"}
            </button>
            <button type="button" onClick={() => setPaste((p) => !p)} className="text-xs text-ink-400 underline">
              {paste ? "Upload a file instead" : "Paste rows instead"}
            </button>
          </div>
          {a?.error ? <p className="text-sm text-rose-300">{a.error}</p> : null}
        </Form>
      ) : (
        <div className="space-y-4">
          <div className="rounded-xl border border-ink-800 bg-ink-900 p-4">
            <p className="text-sm">
              <strong className="text-good">{a.matched}</strong> of {a.total} rows matched a card
              {a.truncated ? " (only the first 5,000 rows are read)" : ""}. Columns found: {a.columns?.join(", ")}.
            </p>
            <Form method="post" className="mt-3 flex gap-3">
              <input type="hidden" name="intent" value="import" />
              <input type="hidden" name="text" value={a.text} />
              <button disabled={busy || !a.matched} className="rounded-md bg-accent px-4 py-1.5 text-sm font-semibold text-black disabled:opacity-50">
                {busy ? "Importing…" : `Import ${a.matched} rows`}
              </button>
              <Link to="/import" reloadDocument className="self-center text-xs text-ink-400 underline">
                Start over
              </Link>
            </Form>
          </div>
          {a.unmatched?.length ? (
            <details className="rounded-xl border border-ink-800 bg-ink-900 p-4 text-xs" open>
              <summary className="cursor-pointer text-sm font-semibold text-rose-300">{a.unmatched.length} rows not matched (they'll be skipped)</summary>
              <ul className="mt-2 max-h-64 space-y-0.5 overflow-y-auto text-ink-400">
                {a.unmatched.map((r) => (
                  <li key={r.line}>
                    Line {r.line}: {r.label}
                  </li>
                ))}
              </ul>
            </details>
          ) : null}
          {a.notes?.length ? (
            <details className="rounded-xl border border-ink-800 bg-ink-900 p-4 text-xs">
              <summary className="cursor-pointer text-sm font-semibold text-amber-300">{a.notes.length} rows adjusted</summary>
              <ul className="mt-2 space-y-0.5 text-ink-400">
                {a.notes.map((r) => (
                  <li key={r.line}>
                    Line {r.line}: {r.problem}
                  </li>
                ))}
              </ul>
            </details>
          ) : null}
          <details className="rounded-xl border border-ink-800 bg-ink-900 p-4 text-xs">
            <summary className="cursor-pointer text-sm font-semibold">First {a.sample?.length} matches</summary>
            <ul className="mt-2 space-y-0.5 text-ink-400">
              {a.sample?.map((r) => (
                <li key={r.line}>
                  Line {r.line}: {r.matched}
                </li>
              ))}
            </ul>
          </details>
        </div>
      )}
    </>
  );
}
