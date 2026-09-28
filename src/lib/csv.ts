/**
 * CSV parsing and column detection for imports. Pure, so it's tested directly.
 * Handles quoted fields, escaped quotes, CRLF, a BOM, and tab- or
 * semicolon-separated files (sniffed from the header line).
 */
export function parseCsv(text: string): string[][] {
  const src = text.replace(/^\uFEFF/, "");
  const firstLine = src.slice(0, src.search(/\r?\n/) === -1 ? src.length : src.search(/\r?\n/));
  const delim = [",", "\t", ";"].map((d) => [d, firstLine.split(d).length] as const).sort((a, b) => b[1] - a[1])[0][0];
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (quoted) {
      if (ch === '"') {
        if (src[i + 1] === '"') {
          field += '"';
          i++;
        } else quoted = false;
      } else field += ch;
      continue;
    }
    if (ch === '"' && field === "") quoted = true;
    else if (ch === delim) {
      row.push(field);
      field = "";
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && src[i + 1] === "\n") i++;
      row.push(field);
      if (row.some((f) => f.trim() !== "")) rows.push(row);
      row = [];
      field = "";
    } else field += ch;
  }
  row.push(field);
  if (row.some((f) => f.trim() !== "")) rows.push(row);
  return rows;
}

export type Column =
  | "name"
  | "set"
  | "number"
  | "quantity"
  | "condition"
  | "printing"
  | "grader"
  | "grade"
  | "paid"
  | "language"
  | "productId";

const SYNONYMS: Record<Column, string[]> = {
  productId: ["tcgplayer product id", "tcgplayer id", "product id", "productid", "tcgplayerid"],
  name: ["name", "card name", "card", "product name", "title"],
  set: ["set", "set name", "expansion", "series set", "group", "edition name"],
  number: ["number", "card number", "collector number", "no", "no.", "#", "card no", "card #"],
  quantity: ["quantity", "qty", "count", "copies", "amount", "owned"],
  condition: ["condition", "card condition", "cond"],
  printing: ["printing", "variant", "finish", "foil", "print", "version", "edition", "rarity variant"],
  grader: ["grading company", "grader", "graded by", "grading service", "company"],
  grade: ["grade", "graded grade", "psa grade"],
  paid: ["price paid", "purchase price", "paid", "cost", "buy price", "purchase"],
  language: ["language", "lang"],
};

const norm = (s: string) => s.trim().toLowerCase().replace(/[_]+/g, " ").replace(/\s+/g, " ");

/** Header index for each recognised column. */
export function detectColumns(header: string[]): Partial<Record<Column, number>> {
  const out: Partial<Record<Column, number>> = {};
  const h = header.map(norm);
  for (const col of Object.keys(SYNONYMS) as Column[]) {
    const idx = h.findIndex((x) => SYNONYMS[col].includes(x));
    if (idx >= 0 && !Object.values(out).includes(idx)) out[col] = idx;
  }
  return out;
}

/** "Near Mint", "NM", "Lightly Played"... to our codes. */
export function mapCondition(raw: string | undefined): string | null {
  const v = norm(raw ?? "");
  if (!v) return null;
  if (/^(m|mint|gem mint)$/.test(v)) return "M";
  if (/near mint|^nm/.test(v)) return "NM";
  if (/lightly|^lp|excellent|^ex$/.test(v)) return "LP";
  if (/moderately|^mp|^good|^played$/.test(v)) return "MP";
  if (/heavily|^hp|^poor$/.test(v)) return "HP";
  if (/damag|^dmg/.test(v)) return "DMG";
  return null;
}

/** "Reverse Holo", "1st Edition Holofoil", "Foil"... to a TCGplayer printing name. */
export function mapPrinting(raw: string | undefined): string | null {
  const v = norm(raw ?? "");
  if (!v) return null;
  if (v.includes("reverse")) return "Reverse Holofoil";
  const first = /1st|first/.test(v);
  const holo = /holo|foil/.test(v) && !/non[\s-]?(holo|foil)/.test(v);
  if (first) return holo ? "1st Edition Holofoil" : "1st Edition";
  if (v.includes("unlimited")) return holo ? "Unlimited Holofoil" : "Unlimited";
  if (holo) return "Holofoil";
  if (/normal|non[\s-]?(holo|foil)|regular|standard/.test(v)) return "Normal";
  return null;
}

/** "PSA 10", "BGS 9.5", "10" (with a separate company column)... */
export function mapGrade(graderRaw: string | undefined, gradeRaw: string | undefined): { grader: string; grade: number } | null {
  const text = `${graderRaw ?? ""} ${gradeRaw ?? ""}`.toUpperCase();
  const grader = ["PSA", "BGS", "CGC", "TAG", "SGC", "ACE"].find((g) => text.includes(g) || (g === "BGS" && text.includes("BECKETT")));
  const m = text.match(/(\d+(?:\.5)?)/);
  if (!grader || !m) return null;
  const grade = Number(m[1]);
  return grade >= 1 && grade <= 10 ? { grader, grade } : null;
}
