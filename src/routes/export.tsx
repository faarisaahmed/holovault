import type { Route } from "./+types/export";
import { requireUser } from "@/lib/server/auth.server";
import { listBinders } from "@/lib/server/binder.server";
import { valuedCollection } from "@/lib/server/collection.server";
import { sealedExport } from "@/lib/server/sealed.server";

/** Downloads the signed-in user's own data. Never cached, never shared. */
export async function loader({ request, params }: Route.LoaderArgs) {
  const user = await requireUser(request);
  const items = await valuedCollection(user.id);
  const date = new Date().toISOString().slice(0, 10);
  const headers = {
    "Cache-Control": "private, no-store",
    "X-Content-Type-Options": "nosniff",
  };

  if (params.format === "json") {
    const body = {
      exportedAt: new Date().toISOString(),
      collection: items.map((i) => ({
        cardId: i.cardId,
        name: i.card?.name,
        set: i.card?.setName,
        number: i.card?.localId,
        printing: i.finish,
        condition: i.condition,
        grader: i.grader,
        grade: i.grade != null ? Number(i.grade) : null,
        certNumber: i.certNumber,
        quantity: i.quantity,
        pricePaid: i.purchaseCents != null ? i.purchaseCents / 100 : null,
        yourValue: i.valueOverrideCents != null ? i.valueOverrideCents / 100 : null,
        marketValue: i.unitValue,
        acquiredOn: i.acquiredOn,
        notes: i.notes,
      })),
      binders: (await listBinders(user.id)).map((b) => ({ name: b.name, rows: b.rows, cols: b.cols, config: b.config })),
      sealed: await sealedExport(user.id),
    };
    return new Response(JSON.stringify(body, null, 2), {
      headers: { ...headers, "Content-Type": "application/json", "Content-Disposition": `attachment; filename="shadowless-${date}.json"` },
    });
  }

  if (params.format !== "csv") throw new Response("Not found", { status: 404 });
  // Leading =, +, - or @ would run as a formula in a spreadsheet; neutralise them.
  const cell = (v: unknown) => {
    let s = v == null ? "" : String(v);
    if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
    return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const header = ["Name", "Set", "Number", "Printing", "Condition", "Grader", "Grade", "Cert Number", "Quantity", "Price Paid", "Market Value", "Acquired", "Notes", "Card ID"];
  const lines = items.map((i) =>
    [
      i.card?.name,
      i.card?.setName,
      i.card?.localId,
      i.finish,
      i.condition,
      i.grader,
      i.grade != null ? Number(i.grade) : "",
      i.certNumber,
      i.quantity,
      i.purchaseCents != null ? (i.purchaseCents / 100).toFixed(2) : "",
      i.unitValue != null ? i.unitValue.toFixed(2) : "",
      i.acquiredOn,
      i.notes,
      i.cardId,
    ]
      .map(cell)
      .join(","),
  );
  return new Response([header.join(","), ...lines].join("\r\n"), {
    headers: { ...headers, "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="shadowless-${date}.csv"` },
  });
}
