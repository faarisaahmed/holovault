import type { Worker } from "tesseract.js";

/**
 * On-device text recognition for the card scanner. The engine and English
 * model are served from /ocr (see scripts/ocr-assets.ts), loaded on first use
 * and kept for the rest of the visit. Photos never leave the browser.
 */

interface Workers {
  /** Reads one line: the card's name. */
  title: Worker;
  /** Reads scattered small print: collector number, set code. */
  small: Worker;
}

let workers: Promise<Workers> | null = null;

/** Two engines so the name and the number are read at the same time. */
function getWorkers(onProgress?: (p: number) => void): Promise<Workers> {
  workers ??= (async () => {
    const { createWorker, OEM, PSM } = await import("tesseract.js");
    const make = () =>
      createWorker("eng", OEM.LSTM_ONLY, {
        workerPath: "/ocr/worker.min.js",
        corePath: "/ocr/",
        langPath: "/ocr",
        workerBlobURL: false,
        logger: (m) => {
          if (m.status.startsWith("loading") && typeof m.progress === "number") onProgress?.(m.progress);
        },
      });
    const [title, small] = await Promise.all([make(), make()]);
    await Promise.all([
      title.setParameters({ tessedit_pageseg_mode: PSM.SINGLE_LINE }),
      small.setParameters({ tessedit_pageseg_mode: PSM.SPARSE_TEXT }),
    ]);
    return { title, small };
  })();
  workers.catch(() => {
    workers = null;
  });
  return workers;
}

/** Warm the engine up while the camera opens. */
export function preloadOcr(onProgress?: (p: number) => void) {
  void getWorkers(onProgress).catch(() => {});
}

async function toBitmap(file: Blob): Promise<ImageBitmap> {
  // Phones store rotation in EXIF; honour it so text reads upright.
  return createImageBitmap(file, { imageOrientation: "from-image" });
}

type Source = ImageBitmap | HTMLCanvasElement;

function draw(img: Source, sx: number, sy: number, sw: number, sh: number, scale: number, boost: boolean) {
  const c = document.createElement("canvas");
  c.width = Math.round(sw * scale);
  c.height = Math.round(sh * scale);
  const ctx = c.getContext("2d", { willReadFrequently: boost })!;
  if (boost) ctx.filter = "grayscale(1) contrast(1.6)";
  ctx.drawImage(img, sx, sy, sw, sh, 0, 0, c.width, c.height);
  return c;
}

/**
 * Light text on a dark band (full-art titles, dark borders) reads far better
 * flipped to dark on light.
 */
function darkToLight(c: HTMLCanvasElement): HTMLCanvasElement {
  const ctx = c.getContext("2d", { willReadFrequently: true })!;
  const img = ctx.getImageData(0, 0, c.width, c.height);
  const px = img.data;
  let sum = 0;
  const step = 4 * 7;
  for (let i = 0; i < px.length; i += step) sum += px[i] * 0.3 + px[i + 1] * 0.59 + px[i + 2] * 0.11;
  if (sum / (px.length / step) >= 110) return c;
  for (let i = 0; i < px.length; i += 4) {
    px[i] = 255 - px[i];
    px[i + 1] = 255 - px[i + 1];
    px[i + 2] = 255 - px[i + 2];
  }
  ctx.putImageData(img, 0, 0);
  return c;
}

export interface CardText {
  title: string;
  bottom: string;
  /** Attacks and abilities, read only when title and number weren't enough. */
  body?: string;
  /** Whole-card read, only when asked for (slow; photos that didn't match). */
  text?: string;
}

/** Scales a region so its text is about the height Tesseract reads best. */
function strip(img: Source, x: number, y: number, w: number, h: number, targetH: number, boost: boolean) {
  return draw(img, x, y, w, h, Math.min(4, targetH / h), boost);
}

/**
 * Reads the two parts of a card that identify it, in parallel: the title
 * line (name) and the bottom strip (number like 199/165, set code like MEW).
 * `card` must be cropped to the card itself. Roughly a quarter of a whole-card
 * read.
 */
export async function readStrips(card: Source, attempt = 0, withBody = false): Promise<CardText> {
  const { title, small } = await getWorkers();
  const W = card.width;
  const H = card.height;
  // Title colours vary wildly, so alternate plain and high-contrast reads
  // between attempts; one of them usually lands.
  const top = darkToLight(strip(card, W * 0.03, H * 0.025, W * 0.8, H * 0.095, 70, attempt % 2 === 1));
  // Collector numbers sit in the bottom tenth, a few pixels tall: enlarge a lot.
  const bottom = darkToLight(strip(card, 0, H * 0.885, W, H * 0.1, 230, true));
  const [t, b] = await Promise.all([title.recognize(top), small.recognize(bottom)]);
  let body: string | undefined;
  if (withBody) {
    const mid = strip(card, W * 0.04, H * 0.5, W * 0.92, H * 0.37, Math.min(700, H * 0.37), false);
    body = (await small.recognize(mid)).data.text;
  }
  return { title: t.data.text, bottom: b.data.text, body };
}

/** The largest card-shaped box centred in an image, at a given share of it. */
function cardBox(img: Source, share: number): [number, number, number, number] {
  const ratio = 63 / 88;
  let h = img.height * share;
  let w = h * ratio;
  if (w > img.width * share) {
    w = img.width * share;
    h = w / ratio;
  }
  return [(img.width - w) / 2, (img.height - h) / 2, w, h];
}

/**
 * Reads a card photo. Assumes the card fills most of the picture, as the tips
 * ask; `thorough` adds a slow whole-picture read for photos that didn't match.
 */
export async function readCard(file: Blob, thorough = false): Promise<CardText> {
  const img = await toBitmap(file);
  try {
    // The card fills "most" of a photo: try it filling nearly all, then a
    // little less. Each line of the title is weighed separately server-side.
    const reads: CardText[] = [];
    for (const share of [0.97, 0.8]) {
      const [x, y, w, h] = cardBox(img, share);
      reads.push(await readStrips(draw(img, x, y, w, h, Math.min(1, 1200 / w), false), reads.length));
    }
    const read = { title: reads.map((r) => r.title.trim()).join("\n"), bottom: reads.map((r) => r.bottom).join("\n") };
    if (!thorough) return read;
    // The slow read: the whole photo, plus its top and bottom enlarged.
    const { small } = await getWorkers();
    const long = Math.max(img.width, img.height);
    const passes = [
      draw(img, 0, 0, img.width, img.height, Math.min(1, 1600 / long), false),
      draw(img, 0, 0, img.width, img.height * 0.16, Math.min(2, 2000 / img.width), true),
      draw(img, 0, img.height * 0.7, img.width, img.height * 0.3, Math.min(2.5, 2400 / img.width), true),
    ];
    const texts: string[] = [];
    for (const c of passes) texts.push((await small.recognize(c)).data.text);
    return { ...read, text: texts.join("\n") };
  } finally {
    img.close();
  }
}

/*
 * Artwork colour fingerprints. When the number is unreadable, several
 * printings share a name; the photo's colours usually tell them apart
 * (Evolutions' orange Charizard vs the 30th Celebration one). A hue histogram
 * weighted by saturation, plus brightness bins for greys, compared by overlap.
 */
const HUE_BINS = 12;
const GREY_BINS = 4;

function histogram(src: CanvasImageSource, sx: number, sy: number, sw: number, sh: number): Float32Array {
  const size = 40;
  const c = document.createElement("canvas");
  c.width = size;
  c.height = size;
  const ctx = c.getContext("2d", { willReadFrequently: true })!;
  ctx.drawImage(src, sx, sy, sw, sh, 0, 0, size, size);
  const px = ctx.getImageData(0, 0, size, size).data;
  const h = new Float32Array(HUE_BINS + GREY_BINS);
  for (let i = 0; i < px.length; i += 4) {
    const r = px[i] / 255;
    const g = px[i + 1] / 255;
    const b = px[i + 2] / 255;
    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    const sat = max === 0 ? 0 : (max - min) / max;
    if (sat < 0.2 || max < 0.15) {
      h[HUE_BINS + Math.min(GREY_BINS - 1, Math.floor(max * GREY_BINS))] += 1;
      continue;
    }
    const d = max - min;
    let hue = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
    hue = (hue * 60 + 360) % 360;
    h[Math.floor(hue / (360 / HUE_BINS)) % HUE_BINS] += sat;
  }
  const sum = h.reduce((a, b) => a + b, 0) || 1;
  return h.map((v) => v / sum);
}

/** The middle of the photo, where the artwork sits when the card fills the frame. */
export async function photoPrint(file: Blob): Promise<Float32Array> {
  const img = await toBitmap(file);
  const h = histogram(img, img.width * 0.18, img.height * 0.15, img.width * 0.64, img.height * 0.38);
  img.close();
  return h;
}

/** A canvas cropped to exactly one card: its artwork window, as on catalog images. */
export function framePrint(card: HTMLCanvasElement): Float32Array {
  return histogram(card, card.width * 0.1, card.height * 0.11, card.width * 0.8, card.height * 0.38);
}

const prints = new Map<string, Promise<Float32Array | null>>();

/** The artwork window of a catalog card image, fetched through /api/card-thumb. */
export function cardPrint(url: string): Promise<Float32Array | null> {
  let p = prints.get(url);
  if (!p) {
    p = new Promise((resolve) => {
      const img = new Image();
      img.onload = () => {
        try {
          const w = img.naturalWidth;
          const h = img.naturalHeight;
          resolve(histogram(img, w * 0.1, h * 0.11, w * 0.8, h * 0.38));
        } catch {
          resolve(null);
        }
      };
      img.onerror = () => resolve(null);
      img.src = `/api/card-thumb?url=${encodeURIComponent(url)}`;
    });
    prints.set(url, p);
  }
  return p;
}

/**
 * Re-ranks candidates by how much each one's artwork looks like the photo.
 * A card whose image can't be read scores the average, not zero, so a missing
 * picture never buries the right card.
 */
export async function rankByLooks<T extends { image: string | null; score: number }>(mine: Float32Array, list: T[], weight = 25): Promise<T[]> {
  const looks = await Promise.all(list.map(async (c) => (c.image ? await cardPrint(c.image) : null)));
  const known = looks.filter((p): p is Float32Array => !!p).map((p) => likeness(mine, p));
  const avg = known.length ? known.reduce((a, b) => a + b, 0) / known.length : 0;
  let k = 0;
  return list
    .map((c, i) => ({ c, v: c.score + (looks[i] ? known[k++] : avg) * weight }))
    .sort((a, b) => b.v - a.v)
    .map((o) => o.c);
}

/** 0 (nothing alike) to 1 (same colours). */
export function likeness(a: Float32Array, b: Float32Array): number {
  let s = 0;
  for (let i = 0; i < a.length; i++) s += Math.min(a[i], b[i]);
  return s;
}
