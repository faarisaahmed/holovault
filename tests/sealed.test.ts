import { test } from "node:test";
import assert from "node:assert/strict";
import { holding, signal, trend, type PricePoint } from "../src/lib/sealed";

test("holdings use average cost across purchases", () => {
  const h = holding(
    [{ quantity: 2, unitCostCents: 10000 }, { quantity: 2, unitCostCents: 14000 }],
    [{ quantity: 1, unitPriceCents: 20000, feesCents: 2500 }],
  );
  assert.equal(h.held, 3);
  assert.equal(h.avgCost, 120);
  assert.equal(h.costBasis, 360);
  assert.equal(h.realized, 200 - 25 - 120);
});

const series = (days: number, f: (i: number) => number): PricePoint[] =>
  Array.from({ length: days + 1 }, (_, i) => ({
    day: new Date(Date.UTC(2026, 0, 1) + i * 86_400_000).toISOString().slice(0, 10),
    market: f(i),
  }));

test("no calls until two weeks of history", () => {
  assert.equal(signal(trend(series(10, () => 100)), null, false).kind, "collecting");
});

test("near the 90-day low and steady reads as a buy", () => {
  const pts = series(60, (i) => (i < 40 ? 150 - i * 1.25 : 100));
  assert.equal(signal(trend(pts), null, false).kind, "buy");
});

test("near the low but still sliding reads as wait", () => {
  const pts = series(60, (i) => 160 - i * 1.5);
  assert.equal(signal(trend(pts), null, false).kind, "wait");
});

test("near the high and well above cost reads as a sell for holders only", () => {
  const pts = series(60, (i) => 100 + i);
  const t = trend(pts);
  assert.equal(signal(t, 100, true).kind, "sell");
  assert.equal(signal(t, 100, false).kind, "hold");
  // Near the high but barely above cost: not a sell.
  assert.equal(signal(t, 150, true).kind, "hold");
});

test("trend reports weekly and monthly change", () => {
  const t = trend(series(40, (i) => 100 + i))!;
  assert.equal(t.current, 140);
  assert.ok(Math.abs(t.change7! - (140 - 133) / 133) < 1e-9);
  assert.ok(Math.abs(t.change30! - (140 - 110) / 110) < 1e-9);
});
