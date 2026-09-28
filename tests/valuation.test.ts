import { test } from "node:test";
import assert from "node:assert/strict";
import { gradingCall, unitValue } from "../src/lib/valuation";

const raw = (condition: string) => ({
  finish: "Holofoil", condition, grader: null, grade: null, valueOverrideCents: null,
});

test("raw copies take the printing's price with a condition discount", () => {
  assert.equal(unitValue(raw("NM"), { finishPrice: 100, cardPrice: 80 }).value, 100);
  assert.equal(unitValue(raw("LP"), { finishPrice: 100, cardPrice: 80 }).value, 85);
  assert.equal(unitValue(raw("NM"), { finishPrice: null, cardPrice: 80 }).value, 80);
  assert.equal(unitValue(raw("NM"), { finishPrice: null, cardPrice: null }).source, "none");
});

test("slabs use PSA comps for their grade, else the raw price", () => {
  const slab = { finish: "Holofoil", condition: null, grader: "PSA", grade: "9.0", valueOverrideCents: null };
  const psa = new Map([["9", 250], ["10", 900]]);
  assert.deepEqual(unitValue(slab, { finishPrice: 100, cardPrice: 100, psa }), { value: 250, source: "graded", estimate: false });
  assert.equal(unitValue({ ...slab, grader: "CGC" }, { finishPrice: 100, cardPrice: 100, psa }).value, 100);
});

test("an owner's own value always wins", () => {
  assert.equal(unitValue({ ...raw("NM"), valueOverrideCents: 1234 }, { finishPrice: 100, cardPrice: 100 }).value, 12.34);
});

test("grade when a PSA 9 beats raw plus grading cost", () => {
  assert.equal(gradingCall({ rawValue: 40, psa9: 90, psa10: 200, cost: 30 }).verdict, "grade");
  assert.equal(gradingCall({ rawValue: 40, psa9: 60, psa10: 200, cost: 30 }).verdict, "maybe");
  assert.equal(gradingCall({ rawValue: 40, psa9: 50, psa10: 60, cost: 30 }).verdict, "no");
  const u = gradingCall({ rawValue: 40, cost: 30 });
  assert.equal(u.verdict, "unknown");
  assert.equal(u.breakEven, 70);
});
