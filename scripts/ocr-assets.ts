/**
 * Copies the on-device OCR engine used by the card scanner into public/ocr so
 * it is served from this site (no third-party CDN, and the CSP stays
 * same-origin). The English model, eng.traineddata.gz, is committed there.
 */
import { copyFileSync, mkdirSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";

const require = createRequire(import.meta.url);
const out = join(process.cwd(), "public", "ocr");
mkdirSync(out, { recursive: true });

const worker = join(dirname(require.resolve("tesseract.js/package.json")), "dist", "worker.min.js");
const core = dirname(require.resolve("tesseract.js-core/package.json"));
copyFileSync(worker, join(out, "worker.min.js"));
for (const f of ["tesseract-core-lstm.wasm.js", "tesseract-core-simd-lstm.wasm.js", "tesseract-core-relaxedsimd-lstm.wasm.js"]) {
  copyFileSync(join(core, f), join(out, f));
}
console.log("OCR engine copied to public/ocr");
