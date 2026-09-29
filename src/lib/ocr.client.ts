import type { Worker } from "tesseract.js";

/**
 * On-device text recognition for the card scanner. The engine and English
 * model are served from /ocr (see scripts/ocr-assets.ts), loaded on first use
 * and kept for the rest of the visit. Photos never leave the browser.
 */

let worker: Promise<Worker> | null = null;

function getWorker(onProgress?: (p: number) => void): Promise<Worker> {
  worker ??= (async () => {
    const { createWorker, OEM, PSM } = await import("tesseract.js");
    const w = await createWorker("eng", OEM.LSTM_ONLY, {
      workerPath: "/ocr/worker.min.js",
      corePath: "/ocr/",
      langPath: "/ocr",
      workerBlobURL: false,
      logger: (m) => {
        if (m.status.startsWith("loading") && typeof m.progress === "number") onProgress?.(m.progress);
      },
    });
    // Cards are scattered text, not paragraphs.
    await w.setParameters({ tessedit_pageseg_mode: PSM.SPARSE_TEXT });
    return w;
  })();
  worker.catch(() => {
    worker = null;
  });
  return worker;
}

/** Warm the engine up while the camera opens. */
export function preloadOcr(onProgress?: (p: number) => void) {
  void getWorker(onProgress).catch(() => {});
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
  const ctx = c.getContext("2d")!;
  if (boost) ctx.filter = "grayscale(1) contrast(1.6)";
  ctx.drawImage(img, sx, sy, sw, sh, 0, 0, c.width, c.height);
  return c;
}

/**
 * Reads a card image: the whole card for the name, the title strip enlarged,
 * then the bottom strip enlarged, where the tiny collector number ("199/165")
 * lives.
 */
async function readImage(img: Source, onProgress?: (p: number) => void): Promise<string> {
  const w = await getWorker(onProgress);
  const long = Math.max(img.width, img.height);
  const whole = draw(img, 0, 0, img.width, img.height, Math.min(1, 1600 / long), false);
  const stripH = img.height * 0.3;
  const stripScale = Math.min(2.5, 2400 / img.width);
  const bottom = draw(img, 0, img.height - stripH, img.width, stripH, stripScale, true);
  const top = draw(img, 0, 0, img.width, img.height * 0.16, Math.min(2, 2000 / img.width), true);
  const parts: string[] = [];
  for (const canvas of [whole, top, bottom]) {
    const { data } = await w.recognize(canvas);
    parts.push(data.text);
  }
  return parts.join("\n");
}

/** Reads a card photo from a file. */
export async function readCard(file: Blob, onProgress?: (p: number) => void): Promise<string> {
  const img = await toBitmap(file);
  try {
    return await readImage(img, onProgress);
  } finally {
    img.close();
  }
}

/** Reads a canvas already cropped to exactly one card (the live scanner's frame). */
export function readFrame(card: HTMLCanvasElement): Promise<string> {
  return readImage(card);
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
