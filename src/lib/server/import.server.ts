import { getDb } from "@/lib/db.server";
import { NOT_SUBSET_COPY, STANDALONE_SUBSETS } from "@/lib/subsets";
import { detectColumns, mapCondition, mapGrade, mapPrinting, parseCsv, type Column } from "@/lib/csv";
import { cents } from "@/lib/valuation";
import { finishPrices, finishesFor, getCard } from "./catalog.server";
import type { ItemInput } from "./collection.server";

export const MAX_BYTES = 2_000_000;
export const MAX_ROWS = 5000;

export interface ImportRow {
  line: number;
  input: ItemInput | null;
  label: string;
  matched: string | null;
  problem?: string;
}

const squash = (s: string) =>
  s
    .toLowerCase()
    .replace(/^(sv|swsh|sm|xy|bw|me)\d{0,2}[a-z]?:\s*/, "")
    .replace(/pok[eé]mon|tcg|the/g, "")
    .replace(/&/g, "and")
    .replace(/[^a-z0-9]+/g, "");

const numberKey = (raw: string) => {
  const m = raw.trim().split("/")[0].toUpperCase().match(/^([A-Z]*)0*(\d+)([A-Z]*)$/);
  return m ? `${m[1]}${Number(m[2])}${m[3]}` : raw.trim().toUpperCase();
};

/** Lookup tables over the catalog, built once per import. */
function indexes() {
  const db = getDb();
  const sets = db.prepare(`SELECT id, name, abbreviation, region FROM sets`).all() as {
    id: string;
    name: string;
    abbreviation: string | null;
    region: string;
  }[];
  const setByKey = new Map<string, string[]>();
  for (const s of sets) {
    // A subset's cards live in its parent set here (Trainer Gallery, Classic
    // Collection...), so its name resolves to the parent.
    const target = STANDALONE_SUBSETS[s.id] ?? s.id;
    for (const k of [squash(s.name), s.id.toLowerCase(), (s.abbreviation ?? "").toLowerCase()]) {
      if (!k) continue;
      setByKey.set(k, [...(setByKey.get(k) ?? []), target]);
    }
  }
  const cards = db
    .prepare(`SELECT id, set_id, local_id, name, region FROM cards WHERE ${NOT_SUBSET_COPY}`)
    .all() as { id: string; set_id: string; local_id: string; name: string; region: string }[];
  const bySetNumber = new Map<string, string>();
  const byNameNumber = new Map<string, string[]>();
  const byNameSet = new Map<string, string[]>();
  for (const c of cards) {
    bySetNumber.set(`${c.set_id}|${numberKey(c.local_id)}`, c.id);
    const nn = `${c.region}|${squash(c.name)}|${numberKey(c.local_id)}`;
    byNameNumber.set(nn, [...(byNameNumber.get(nn) ?? []), c.id]);
    const ns = `${c.set_id}|${squash(c.name)}`;
    byNameSet.set(ns, [...(byNameSet.get(ns) ?? []), c.id]);
  }
  const byProduct = db.prepare(`SELECT card_id, variant FROM card_prices WHERE tcgplayer_product_id = ?`);
  return { setByKey, bySetNumber, byNameNumber, byNameSet, byProduct };
}

/**
 * Reads a CSV and matches each row to a catalog card. Nothing is written; the
 * caller shows the preview and imports only the matched rows on confirm.
 */
export function previewImport(text: string, defaultRegion: "en" | "ja", defaultCondition: string) {
  const table = parseCsv(text);
  if (table.length < 2) return { error: "That file has no rows under its header.", rows: [], columns: {} };
  const columns = detectColumns(table[0]);
  if (columns.productId == null && columns.name == null && (columns.set == null || columns.number == null)) {
    return {
      error: "Couldn't find the card columns. The file needs a card name, or a set and number, or a TCGplayer product ID.",
      rows: [],
      columns,
    };
  }
  const ix = indexes();
  const get = (r: string[], c: Column) => (columns[c] != null ? (r[columns[c]!] ?? "").trim() : "");

  const rows: ImportRow[] = table.slice(1, MAX_ROWS + 1).map((r, i) => {
    const name = get(r, "name");
    const setName = get(r, "set");
    const number = get(r, "number");
    const label = [name, setName, number].filter(Boolean).join(" · ") || `row ${i + 2}`;
    const region = /japan|jp|日本/i.test(get(r, "language")) ? "ja" : defaultRegion;

    let cardId: string | null = null;
    let finishFromProduct: string | null = null;
    const pid = Number(get(r, "productId"));
    if (pid) {
      const hits = ix.byProduct.all(pid) as { card_id: string; variant: string }[];
      if (hits[0]) {
        cardId = hits[0].card_id;
        if (hits.length === 1) finishFromProduct = hits[0].variant;
      }
    }
    if (!cardId && setName && number) {
      for (const sid of ix.setByKey.get(squash(setName)) ?? ix.setByKey.get(setName.toLowerCase()) ?? []) {
        cardId = ix.bySetNumber.get(`${sid}|${numberKey(number)}`) ?? null;
        if (cardId) break;
      }
    }
    if (!cardId && name && number) {
      const hits = ix.byNameNumber.get(`${region}|${squash(name)}|${numberKey(number)}`) ?? [];
      if (hits.length === 1) cardId = hits[0];
    }
    if (!cardId && name && setName) {
      for (const sid of ix.setByKey.get(squash(setName)) ?? []) {
        const hits = ix.byNameSet.get(`${sid}|${squash(name)}`) ?? [];
        if (hits.length === 1) {
          cardId = hits[0];
          break;
        }
      }
    }
    if (!cardId) return { line: i + 2, input: null, label, matched: null, problem: "No matching card" };

    const card = getCard(cardId);
    if (!card) return { line: i + 2, input: null, label, matched: null, problem: "No matching card" };
    const finishes = finishesFor(card, finishPrices([cardId]).get(cardId));
    const wanted = finishFromProduct ?? mapPrinting(get(r, "printing"));
    const finish = wanted && finishes.includes(wanted) ? wanted : finishes[0];
    // Some exports put "PSA 10" in the condition column.
    const graded = mapGrade(get(r, "grader"), get(r, "grade")) ?? mapGrade("", get(r, "condition"));
    const qty = Math.min(999, Math.max(1, Math.round(Number(get(r, "quantity")) || 1)));
    const paid = Number(get(r, "paid").replace(/[$,\s]/g, ""));

    const input: ItemInput = {
      cardId,
      finish,
      condition: graded ? null : (mapCondition(get(r, "condition")) ?? defaultCondition),
      grader: (graded?.grader as ItemInput["grader"]) ?? null,
      grade: graded?.grade ?? null,
      certNumber: null,
      quantity: qty,
      purchase: Number.isFinite(paid) && paid > 0 ? cents(paid) : null,
      valueOverride: null,
      acquiredOn: null,
      notes: null,
    };
    const note = wanted && !finishes.includes(wanted) ? `${wanted} isn't a printing of this card; using ${finish}` : undefined;
    return { line: i + 2, input, label, matched: `${card.name} · ${card.setName} ${card.localId} · ${finish}`, problem: note };
  });
  return { rows, columns, truncated: table.length - 1 > MAX_ROWS };
}
