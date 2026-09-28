import { test } from "node:test";
import assert from "node:assert/strict";
import { detectColumns, mapCondition, mapGrade, mapPrinting, parseCsv } from "../src/lib/csv";

test("parses quotes, escaped quotes, CRLF and a BOM", () => {
  const rows = parseCsv('﻿Name,Set,Qty\r\n"Charizard ex","Scarlet & Violet—151",2\r\n"Farfetch\'d ""Sir""",Emerald,1\r\n');
  assert.deepEqual(rows, [
    ["Name", "Set", "Qty"],
    ["Charizard ex", "Scarlet & Violet—151", "2"],
    ['Farfetch\'d "Sir"', "Emerald", "1"],
  ]);
});

test("sniffs tab and semicolon files", () => {
  assert.deepEqual(parseCsv("a\tb\n1\t2"), [["a", "b"], ["1", "2"]]);
  assert.deepEqual(parseCsv("a;b\n1;2"), [["a", "b"], ["1", "2"]]);
});

test("detects common column names", () => {
  const cols = detectColumns(["Product Name", "Set Name", "Card Number", "Quantity", "Condition", "Printing", "TCGplayer Product ID"]);
  assert.deepEqual(cols, { productId: 6, name: 0, set: 1, number: 2, quantity: 3, condition: 4, printing: 5 });
});

test("maps conditions, printings and grades", () => {
  assert.equal(mapCondition("Near Mint"), "NM");
  assert.equal(mapCondition("Lightly Played"), "LP");
  assert.equal(mapCondition("Damaged"), "DMG");
  assert.equal(mapPrinting("Reverse Holo"), "Reverse Holofoil");
  assert.equal(mapPrinting("1st Edition Holofoil"), "1st Edition Holofoil");
  assert.equal(mapPrinting("Non-Holo"), "Normal");
  assert.equal(mapPrinting("Foil"), "Holofoil");
  assert.deepEqual(mapGrade("", "PSA 10"), { grader: "PSA", grade: 10 });
  assert.deepEqual(mapGrade("Beckett", "9.5"), { grader: "BGS", grade: 9.5 });
  assert.equal(mapGrade("", "Near Mint"), null);
});
