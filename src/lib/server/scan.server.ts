import { getDb } from "@/lib/db.server";
import { editDistance, normalizeName, parseScanText, type ScanClues } from "@/lib/scan";
import { NOT_SUBSET_COPY } from "@/lib/subsets";
import type { Region } from "@/lib/types";
import { cardsByIds, type CatalogCard } from "./catalog.server";

/**
 * Ranks catalog cards against what the scanner read off a photo. The
 * collector number with its set total ("199/165") narrows things to a card or
 * two; the name confirms it and settles promos and cards without a total.
 */

interface NameIndex {
  /** Normalized full names, longest first so "charizard ex" beats "charizard". */
  names: string[];
  /** First word → full names starting with it, for OCR-mangled first words. */
  byFirst: Map<string, string[]>;
  /** Normalized name → the catalog's spellings of it. */
  raw: Map<string, string[]>;
}

const indexes = new Map<Region, NameIndex>();

function nameIndex(region: Region): NameIndex {
  const cached = indexes.get(region);
  if (cached) return cached;
  const rows = getDb()
    .prepare(`SELECT DISTINCT name FROM cards WHERE region = ?`)
    .all(region) as { name: string }[];
  const raw = new Map<string, string[]>();
  for (const r of rows) {
    const n = normalizeName(r.name);
    if (n.length >= 3) raw.set(n, [...(raw.get(n) ?? []), r.name]);
  }
  const names = [...raw.keys()].sort((a, b) => b.length - a.length);
  const byFirst = new Map<string, string[]>();
  for (const n of names) {
    const first = n.split(" ")[0];
    if (first.length < 4) continue;
    byFirst.set(first, [...(byFirst.get(first) ?? []), n]);
  }
  const idx = { names, byFirst, raw };
  indexes.set(region, idx);
  return idx;
}

const compact = (s: string) => s.replace(/[^a-z0-9]/g, "");

/** "Pokémon ex rule" and friends: which mechanic the card belongs to. */
const MECHANICS: [RegExp, string][] = [
  [/\bvmax rule\b/, "vmax"],
  [/\bvstar rule\b/, "vstar"],
  [/\bv rule\b/, "v"],
  [/\bex rule\b/, "ex"],
  [/\bgx rule\b|\bgx attack\b/, "gx"],
];

/**
 * Card names found in the text, in reading order. OCR often breaks a stylized
 * title into pieces ("ch ari zard"), so longer names are matched with spaces
 * removed. The first one is usually the title; "Evolves from Charmeleon" is
 * dropped so the evolution line can't win.
 */
function namesIn(text: string, clues: ScanClues, region: Region): { title: string | null; others: string[]; fuzzy: string[] } {
  const idx = nameIndex(region);
  const norm = normalizeName(text).replace(/evolves from \S+( \S+)?/g, " ");
  const hay = ` ${norm} `;
  const flat = compact(norm);
  // Stylized titles come out with digits for letters ("char1zard").
  const lettered = flat.replace(/[01583]/g, (d) => ({ "0": "o", "1": "i", "5": "s", "8": "b", "3": "e" })[d]!);
  const hits: { name: string; pos: number; len: number }[] = [];
  for (const n of idx.names) {
    const c = compact(n);
    if (c.length >= 5 || (c.length === 4 && n.includes(" "))) {
      let pos = flat.indexOf(c);
      if (pos < 0) pos = lettered.indexOf(c);
      if (pos >= 0) hits.push({ name: n, pos, len: c.length });
    } else {
      // Short names ("Mew", "Muk") only as whole words, or they'd match everywhere.
      const at = hay.indexOf(` ${n} `);
      if (at >= 0) hits.push({ name: n, pos: compact(hay.slice(0, at)).length, len: c.length });
    }
  }
  // A hit inside a longer hit at the same spot is the same text.
  const kept = hits
    .filter((h) => !hits.some((o) => o !== h && o.len > h.len && o.pos <= h.pos && o.pos + o.len >= h.pos + h.len))
    .sort((a, b) => a.pos - b.pos);
  const names = [...new Set(kept.map((h) => h.name))];

  let title = names[0] ?? null;
  const mech = MECHANICS.find(([re]) => re.test(hay))?.[1];
  if (title && mech && !title.endsWith(` ${mech}`) && idx.raw.has(`${title} ${mech}`)) title = `${title} ${mech}`;

  const fuzzy: string[] = [];
  if (!title) {
    for (const w of clues.words) {
      if (w.length < 5) continue;
      for (const [first, full] of idx.byFirst) {
        if (Math.abs(first.length - w.length) > 1) continue;
        if (editDistance(w, first, 1) <= 1) fuzzy.push(...full);
      }
      if (fuzzy.length > 40) break;
    }
  }
  return { title, others: names.slice(1, 4), fuzzy: [...new Set(fuzzy)] };
}

/** "TG1" also as "TG01" and "TG001": sets pad gallery numbers differently. */
function padded(local: string): { pad2: string; pad3: string } {
  const m = local.match(/^([A-Z]*)(\d+)$/);
  if (!m) return { pad2: local, pad3: local };
  return { pad2: m[1] + m[2].padStart(2, "0"), pad3: m[1] + m[2].padStart(3, "0") };
}

export interface ScanMatch {
  card: CatalogCard;
  score: number;
  /** Plain-language reason, shown under the candidate. */
  why: string;
}

export function matchScan(text: string, region: Region, limit = 8): { matches: ScanMatch[]; clues: ScanClues; guess: string | null } {
  const clues = parseScanText(text);
  const { title, others, fuzzy } = namesIn(text, clues, region);
  const db = getDb();
  const scores = new Map<string, { score: number; why: string[] }>();
  const bump = (id: string, pts: number, why: string) => {
    const s = scores.get(id) ?? { score: 0, why: [] };
    s.score += pts;
    if (!s.why.includes(why)) s.why.push(why);
    scores.set(id, s);
  };
  const notCopy = NOT_SUBSET_COPY.replace("id", "c.id");

  for (const num of clues.numbers.slice(0, 6)) {
    const rows = db
      .prepare(
        `SELECT c.id, s.card_count_official total, upper(c.local_id) local, lower(s.id) set_id, lower(coalesce(s.abbreviation, '')) abbr
         FROM cards c JOIN sets s ON s.id = c.set_id
         WHERE c.region = @region AND ${notCopy}
           AND (upper(c.local_id) IN (@local, @pad2, @pad3) OR (c.number_sort = @n AND @local GLOB '[0-9]*'))
         LIMIT 400`,
      )
      .all({ region, local: num.local, n: num.n, ...padded(num.local) }) as { id: string; total: number; local: string; set_id: string; abbr: string }[];
    for (const r of rows) {
      const totalHit = num.total != null && r.total === num.total;
      if (num.total != null && !totalHit) {
        // Wrong set size: only worth anything if the name also agrees.
        bump(r.id, 2, `No. ${num.local}`);
        continue;
      }
      bump(r.id, totalHit ? 40 : 12, totalHit ? `No. ${num.local}/${num.total}` : `No. ${num.local}`);
      if (clues.setCodes.some((c) => c === r.set_id || c === r.abbr)) bump(r.id, 15, "set code");
    }
  }

  const spellings = nameIndex(region).raw;
  const byName = (names: string[], pts: number, label: string) => {
    const rawNames = names.flatMap((n) => spellings.get(n) ?? []).slice(0, 200);
    if (!rawNames.length) return;
    const rows = db
      .prepare(
        `SELECT c.id FROM cards c
         WHERE c.region = ? AND ${notCopy} AND c.name IN (${rawNames.map(() => "?").join(",")})`,
      )
      .all(region, ...rawNames) as { id: string }[];
    for (const r of rows) {
      // Only boost cards already found by number, unless nothing was.
      if (scores.size && !scores.has(r.id) && clues.numbers.length) {
        bump(r.id, pts / 4, label);
        continue;
      }
      bump(r.id, pts, label);
    }
  };
  byName(title ? [title] : [], 30, "name");
  byName(others, 6, "name");
  byName(fuzzy, 12, "similar name");

  const ranked = [...scores.entries()].sort((a, b) => b[1].score - a[1].score).slice(0, 60);
  const cards = cardsByIds(ranked.map(([id]) => id));
  const matches = ranked
    .map(([id, s]) => ({ card: cards.get(id)!, score: s.score, why: s.why.join(" · ") }))
    .filter((m) => m.card)
    // Equal scores: newer sets first, they're what people are opening.
    .sort((a, b) => b.score - a.score || (b.card.releaseDate ?? "").localeCompare(a.card.releaseDate ?? ""))
    .slice(0, limit);

  return { matches, clues, guess: title };
}
