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

const compact = (s: string) => s.replace(/[^\p{L}\p{N}]/gu, "");

/** "Pokémon ex rule" and friends: which mechanic the card belongs to. */
const MECHANICS: [RegExp, string][] = [
  [/\bvmax rule\b/, "vmax"],
  [/\bvstar rule\b/, "vstar"],
  [/\bv rule\b/, "v"],
  [/\b(ex|x) ru[lf]e\b/, "ex"],
  [/\bgx rule\b|\bgx attack\b/, "gx"],
];

/**
 * Card names found in the text, in reading order. OCR often breaks a stylized
 * title into pieces ("ch ari zard"), so longer names are matched with spaces
 * removed. The first one is usually the title; "Evolves from Charmeleon" is
 * dropped so the evolution line can't win.
 */
function namesIn(
  text: string,
  clues: ScanClues,
  region: Region,
): { title: string | null; longer: string[]; others: string[]; fuzzy: string[] } {
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
  // Small print is often lost: "Rocket's" above "Suicune ex", "Dark" before
  // "Charizard". Longer names ending in the title are candidates too.
  const longer = title ? idx.names.filter((n) => n !== title && n.endsWith(` ${title}`)).slice(0, 12) : [];
  return { title, longer, others: names.slice(1, 4), fuzzy: [...new Set(fuzzy)] };
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

/** Words on a title line that aren't part of the name. */
const TITLE_NOISE = new Set(["basic", "stage", "hp", "lv", "evolves", "from", "put", "on", "the", "pokemon", "restored", "baby"]);

/**
 * The card name from the title line alone. Stylized titles come apart ("ch
 * ari zard"), so names are matched with spaces removed, longest first; failing
 * that, the closest name within two typos.
 */
function titleName(title: string, region: Region): { name: string | null; exact: boolean } {
  // Several reads of the title can arrive, one per line: take the best.
  const lines = title.split("\n").filter((l) => l.trim());
  if (lines.length > 1) {
    const results = lines.map((l) => titleLine(l, region));
    const exact = results.filter((r) => r.exact && r.name).sort((a, b) => b.name!.length - a.name!.length)[0];
    return exact ?? results.find((r) => r.name) ?? { name: null, exact: false };
  }
  return titleLine(title, region);
}

function titleLine(title: string, region: Region): { name: string | null; exact: boolean } {
  const idx = nameIndex(region);
  // The stylized "ex" logo reads as "@X", "&X" or "8X".
  const words = normalizeName(title.replace(/[@&©€]\s?\S?|\b8[xX]\b/g, " ex ").replace(/たね|[12１２]?進化|ＨＰ/g, " "))
    .split(" ")
    .filter((w) => w && !TITLE_NOISE.has(w) && !/\d/.test(w));
  const flat = compact(words.join(" "));
  if (flat.length < 3) return { name: null, exact: false };
  const lettered = flat.replace(/[01583]/g, (d) => ({ "0": "o", "1": "i", "5": "s", "8": "b", "3": "e" })[d]!);
  for (const n of idx.names) {
    const c = compact(n);
    if (c.length < 3 || c.length > flat.length) continue;
    // Short names must be most of the line, or "mew" would hide in "mewtwo".
    if (c.length < 5 && c.length < flat.length - 2) continue;
    if (flat.includes(c) || lettered.includes(c)) return { name: n, exact: true };
  }
  if (flat.length < 5) return { name: null, exact: false };
  // Kana OCR mixes up サ/ザ and ハ/バ/パ: compare with the marks stripped.
  const base = (x: string) => x.normalize("NFKD").replace(/[\u3099\u309a\u30fc\u2212-]/g, "");
  const fb = base(flat);
  let best: { name: string; d: number } | null = null;
  for (const n of idx.names) {
    const c = compact(n);
    if (Math.abs(c.length - flat.length) > 2) continue;
    const d = editDistance(fb, base(c), 2);
    if (d <= 2 && (!best || d < best.d)) best = { name: n, d };
    if (best?.d === 1) break;
  }
  return best ? { name: best.name, exact: false } : { name: null, exact: false };
}

const abbrevs = new Map<Region, Map<string, string[]>>();

/** Printed set codes ("MEW", "PAL") → set ids, from TCGplayer's abbreviations. */
function setsByAbbrev(region: Region): Map<string, string[]> {
  let m = abbrevs.get(region);
  if (m) return m;
  m = new Map();
  const rows = getDb().prepare(`SELECT id, upper(abbreviation) a FROM sets WHERE region = ? AND abbreviation IS NOT NULL`).all(region) as {
    id: string;
    a: string;
  }[];
  for (const r of rows) m.set(r.a, [...(m.get(r.a) ?? []), r.id]);
  abbrevs.set(region, m);
  return m;
}

/** Attack and ability names → the cards that have them. Rare ones only: "Tackle" is everywhere. */
const moveIndexes = new Map<Region, { names: [string, string[]][] }>();

function moveIndex(region: Region) {
  let idx = moveIndexes.get(region);
  if (idx) return idx;
  const byMove = new Map<string, string[]>();
  const rows = getDb().prepare(`SELECT id, moves FROM cards WHERE region = ? AND moves IS NOT NULL AND instr(id, '@') = 0`).all(region) as {
    id: string;
    moves: string;
  }[];
  for (const r of rows) {
    for (const m of r.moves.split(" | ")) {
      const c = compact(normalizeName(m));
      if (c.length >= 7) byMove.set(c, [...(byMove.get(c) ?? []), r.id]);
    }
  }
  idx = { names: [...byMove.entries()].filter(([, ids]) => ids.length <= 40) };
  moveIndexes.set(region, idx);
  return idx;
}

/** Cards whose attacks or abilities appear in the text, with how many matched. */
function cardsByMoves(text: string, region: Region): Map<string, number> {
  const flat = compact(normalizeName(text));
  const out = new Map<string, number>();
  if (flat.length < 7) return out;
  for (const [move, ids] of moveIndex(region).names) {
    // Long names also match with an end letter lost ("yper Splash").
    const hit = flat.includes(move) || (move.length >= 9 && (flat.includes(move.slice(1)) || flat.includes(move.slice(0, -1))));
    if (!hit) continue;
    for (const id of ids) out.set(id, (out.get(id) ?? 0) + 1);
  }
  return out;
}

export type ScanOffer = "sure" | "choose" | "wait";

export interface ScanInput {
  /** The title strip: the card's name. */
  title?: string;
  /** The bottom strip: collector number, set code, illustrator. */
  bottom?: string;
  /** A whole-card read, used when the strips found nothing. */
  text?: string;
  /** The middle of the card: attacks and abilities. */
  body?: string;
}

export function matchScan(
  input: ScanInput | string,
  region: Region,
  limit = 8,
): { matches: ScanMatch[]; clues: ScanClues; guess: string | null; confident: boolean; offer: ScanOffer } {
  const { title: titleText = "", bottom = "", text = "", body = "" } = typeof input === "string" ? { text: input } : input;
  const clues = parseScanText(`${bottom}\n${text}`);
  const fromTitle = titleText ? titleName(titleText, region) : { name: null, exact: false };
  // Without a title strip, fall back to names anywhere in the text.
  const loose = !fromTitle.name && text ? namesIn(text, clues, region) : null;
  let title = fromTitle.name ?? loose?.title ?? null;
  // "Pokémon ex rule" (or V, VMAX, VSTAR, GX) in the small print says which
  // kind of card it is when the title's logo didn't read.
  const rules = normalizeName(`${bottom}\n${text}`);
  const mech = MECHANICS.find(([re]) => re.test(rules))?.[1];
  if (title && mech && !title.endsWith(` ${mech}`) && nameIndex(region).raw.has(`${title} ${mech}`)) title = `${title} ${mech}`;
  const exactTitle = fromTitle.name ? fromTitle.exact : !!loose?.title;
  const idx = nameIndex(region);
  // Small print and logos get lost: "Rocket's" above "Suicune ex", or the ex /
  // V / GX logo after a name. Those fuller names are candidates too, and the
  // artwork's colours pick between them.
  const SUFFIXES = ["ex", "v", "vmax", "vstar", "gx"];
  const longer =
    title
      ? idx.names
          .filter(
            (n) =>
              n !== title && ((exactTitle && n.endsWith(` ${title}`)) || SUFFIXES.some((x) => n === `${title} ${x}` || n === `${title}${x}`)),
          )
          .slice(0, 12)
      : [];

  const abbrSets = new Set<string>();
  const codes = setsByAbbrev(region);
  for (const m of `${bottom}\n${text}`.matchAll(/\b([A-Z][A-Z0-9]{2})\b/g)) for (const id of codes.get(m[1]) ?? []) abbrSets.add(id);

  const db = getDb();
  const scores = new Map<string, { score: number; why: string[]; name: string; setId: string }>();
  const bump = (row: { id: string; name: string; set_id: string }, pts: number, why: string) => {
    const s = scores.get(row.id) ?? { score: 0, why: [], name: row.name, setId: row.set_id };
    s.score += pts;
    if (!s.why.includes(why)) s.why.push(why);
    scores.set(row.id, s);
  };
  const notCopy = NOT_SUBSET_COPY.replace("id", "c.id");

  for (const num of clues.numbers.slice(0, 6)) {
    const rows = db
      .prepare(
        `SELECT c.id, c.name, c.set_id, s.card_count_official total, lower(s.id) sid, lower(coalesce(s.abbreviation, '')) abbr
         FROM cards c JOIN sets s ON s.id = c.set_id
         WHERE c.region = @region AND ${notCopy}
           AND (upper(c.local_id) IN (@local, @pad2, @pad3) OR (c.number_sort = @n AND @local GLOB '[0-9]*'))
         LIMIT 400`,
      )
      .all({ region, local: num.local, n: num.n, ...padded(num.local) }) as {
      id: string;
      name: string;
      set_id: string;
      total: number;
      sid: string;
      abbr: string;
    }[];
    for (const r of rows) {
      const totalHit = num.total != null && r.total === num.total;
      // A total that disagrees means another set; drop it.
      if (num.total != null && !totalHit) continue;
      // A number pieced together from run-on digits needs another clue to back it.
      if (totalHit && num.split) bump(r, 25, `No. ${num.local}/${num.total}?`);
      else bump(r, totalHit ? 40 : 12, totalHit ? `No. ${num.local}/${num.total}` : `No. ${num.local}`);
      if (clues.setCodes.some((c) => c === r.sid || c === r.abbr)) bump(r, 20, "set code");
    }
  }

  const byName = (names: string[], pts: number, label: string) => {
    const rawNames = names.flatMap((n) => idx.raw.get(n) ?? []).slice(0, 200);
    if (!rawNames.length) return;
    const rows = db
      .prepare(
        `SELECT c.id, c.name, c.set_id FROM cards c
         WHERE c.region = ? AND ${notCopy} AND c.name IN (${rawNames.map(() => "?").join(",")})`,
      )
      .all(region, ...rawNames) as { id: string; name: string; set_id: string }[];
    for (const r of rows) bump(r, pts, label);
  };
  byName(title ? [title] : [], exactTitle ? 30 : 20, exactTitle ? "name" : "similar name");
  byName(longer, 22, "name");

  // Attacks: two matching is as good as a name; one helps. Cards found only
  // this way still count, which rescues unreadable titles.
  const moves = cardsByMoves(`${body}\n${text}`, region);
  if (moves.size && moves.size <= 60) {
    const info = db
      .prepare(`SELECT id, name, set_id FROM cards WHERE id IN (${[...moves.keys()].map(() => "?").join(",")})`)
      .all(...moves.keys()) as { id: string; name: string; set_id: string }[];
    for (const r of info) bump(r, moves.get(r.id)! >= 2 ? 30 : 18, "attack");
  }

  // The printed set code confirms whichever candidates are from that set.
  if (abbrSets.size) for (const [id, s] of scores) if (abbrSets.has(s.setId)) bump({ id, name: s.name, set_id: s.setId }, 20, "set code");

  const ranked = [...scores.entries()].sort((a, b) => b[1].score - a[1].score).slice(0, 60);
  const cards = cardsByIds(ranked.map(([id]) => id));
  const matches = ranked
    .map(([id, s]) => ({ card: cards.get(id)!, score: s.score, why: s.why.join(" · ") }))
    .filter((m) => m.card)
    // Equal scores: newer sets first, they're what people are opening.
    .sort((a, b) => b.score - a.score || (b.card.releaseDate ?? "").localeCompare(a.card.releaseDate ?? ""))
    .slice(0, limit);

  // Confident when two independent clues agree on one card and it clearly leads.
  const [a, b] = matches;
  // A title that names a different card vetoes it: the number was misread.
  const nameAgrees = !title || !a || [title, ...longer].includes(normalizeName(a.card.name));
  const byNumber = !!a && /No\. \S+\/\d+(?![\d?])/.test(a.why);
  const clear = !!a && a.score - (b?.score ?? 0) >= 15;
  // sure: two clues agree (or the number alone, with no title to contradict it)
  //   and one card leads. choose: the number narrows it to a few. wait: guesswork.
  const offer: ScanOffer =
    a && nameAgrees && clear && (a.score >= 50 || (byNumber && !title)) ? "sure" : byNumber && nameAgrees ? "choose" : "wait";
  return { matches, clues, guess: title, confident: offer === "sure", offer };
}
