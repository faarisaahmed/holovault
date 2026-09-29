import assert from "node:assert/strict";
import { test } from "node:test";
import { editDistance, normalizeName, parseScanText } from "../src/lib/scan";

test("reads a plain collector number with its set total", () => {
  const c = parseScanText("Charizard ex 330 HP ... Illus. 5ban 199/165 SAR");
  assert.deepEqual(c.numbers, [{ local: "199", n: 199, total: 165 }]);
});

test("fixes digits OCR mistakes for letters and strips zero padding", () => {
  const c = parseScanText("Pikachu 06O/l98");
  assert.deepEqual(c.numbers[0], { local: "60", n: 60, total: 198 });
});

test("keeps gallery prefixes only when both sides carry them", () => {
  assert.equal(parseScanText("Umbreon TG12/TG30").numbers[0].local, "TG12");
  assert.equal(parseScanText("Tentacruel H26/H32").numbers[0].local, "H26");
  assert.equal(parseScanText("Mew V 251/264").numbers[0].local, "251");
});

test("ignores tiny totals that are just noise", () => {
  assert.deepEqual(parseScanText("Flip 1/2 coins").numbers, []);
});

test("finds Japanese set codes", () => {
  assert.deepEqual(parseScanText("173/165 SV2a").setCodes, ["sv2a"]);
});

test("normalizes names for matching", () => {
  assert.equal(normalizeName("Flabébé  (Rocket's)"), "flabebe rocket's");
});

test("edit distance stops early past the cap", () => {
  assert.equal(editDistance("charizard", "charizrd", 1), 1);
  assert.equal(editDistance("charizard", "blastoise", 1), 2);
});
