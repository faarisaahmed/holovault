/**
 * Turns the text OCR reads off a card photo into search clues: the collector
 * number ("199/165", "TG12/TG30"), a set code printed near it
 * ("sv8a", "SV3a") and loose words that may spell the card's name. Shared by
 * the scanner page and its tests; the matching itself runs on the server.
 */

export interface ScanNumber {
  /** As printed, uppercased: "199", "TG12". */
  local: string;
  /** Numeric part for number_sort matching. */
  n: number;
  /** The "/165" total when visible. */
  total: number | null;
}

export interface ScanClues {
  numbers: ScanNumber[];
  setCodes: string[];
  words: string[];
}

/** Letters OCR commonly confuses with digits inside a number. */
const DIGITISH: Record<string, string> = { O: "0", o: "0", D: "0", Q: "0", I: "1", l: "1", "|": "1", i: "1", S: "5", s: "5", B: "8", Z: "2", z: "2" };
const digits = (s: string) => s.replace(/[OoDQIl|iSsBZz]/g, (c) => DIGITISH[c] ?? c);

// "199/165", "TG12/TG30", "GG35/GG70", "H26/H32", "SV085/SV122", with OCR noise.
const PAIR = /(?<![A-Za-z0-9])([A-Z]{0,2})\s?([0-9OoIl|SD]{1,3})\s?[/⁄∕|l1%]\s?([A-Z]{0,2})\s?([0-9OoIl|SD]{2,3})(?![0-9])/g;
const SET_CODE = /\b((?:sv|s|sm|m)\d{1,2}[a-z]?|sv\d{1,2}\.\d|swsh\d{1,2}(?:\.\d)?)\b/gi;

export function parseScanText(raw: string): ScanClues {
  const text = raw.replace(/[‘’`´]/g, "'").replace(/\s+/g, " ");
  const numbers: ScanNumber[] = [];
  const seen = new Set<string>();
  const push = (local: string, total: number | null) => {
    const n = Number(local.replace(/^\D+/, ""));
    if (!Number.isFinite(n) || n <= 0 || n > 999) return;
    // A total smaller than 20 is almost always noise ("1/2 pages").
    if (total != null && (total < 20 || n > total * 2)) return;
    const key = `${local}/${total ?? ""}`;
    if (seen.has(key)) return;
    seen.add(key);
    numbers.push({ local, n, total });
  };

  for (const m of text.matchAll(PAIR)) {
    const [, pre, num, totPre, tot] = m;
    // Gallery and holo-rare numbers carry the prefix on both sides (TG12/TG30,
    // H26/H32); a lone letter before the number is a stray word ("Mew V 251").
    const prefix = pre && pre === totPre ? pre : "";
    const local = `${prefix}${digits(num).replace(/^0+(?=\d)/, "")}`;
    push(local, Number(digits(tot)));
  }

  const setCodes = [...new Set([...text.matchAll(SET_CODE)].map((m) => m[1].toLowerCase()))];
  const words = [
    ...new Set(
      normalizeName(text)
        .split(" ")
        .filter((w) => w.length >= 3 && /[a-z]/.test(w)),
    ),
  ];
  return { numbers, setCodes, words };
}

/** Lowercase, accents off ("Flabébé" → "flabebe"), punctuation to spaces. */
export function normalizeName(s: string): string {
  return s
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9' ]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Edit distance, capped: returns cap + 1 once it's clearly further. */
export function editDistance(a: string, b: string, cap = 2): number {
  if (Math.abs(a.length - b.length) > cap) return cap + 1;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    let best = i;
    for (let j = 1; j <= b.length; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
      best = Math.min(best, cur[j]);
    }
    if (best > cap) return cap + 1;
    prev = cur;
  }
  return prev[b.length];
}
