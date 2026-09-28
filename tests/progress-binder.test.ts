import { test } from "node:test";
import assert from "node:assert/strict";
import { progress, type ProgressCard } from "../src/lib/progress";
import { binderConfig, normalizeConfig, paginate, planSlots, type BinderCandidate } from "../src/lib/binder";

const cards: ProgressCard[] = [
  { id: "a", finishes: ["Normal", "Reverse Holofoil"], prices: { Normal: 0.1, "Reverse Holofoil": 0.5 } },
  { id: "b", finishes: ["Holofoil", "Reverse Holofoil"], prices: { Holofoil: 2, "Reverse Holofoil": 3 } },
  { id: "c", finishes: ["Holofoil"], prices: { Holofoil: null } },
];

test("base progress counts a card once, whatever printing", () => {
  const owned = new Map([["a", new Map([["Reverse Holofoil", 1]])]]);
  const p = progress(cards, owned, false);
  assert.equal(p.have, 1);
  assert.equal(p.total, 3);
  assert.equal(p.costToComplete, 2); // cheapest printing of b; c is unpriced
  assert.equal(p.unpricedMissing, 1);
});

test("master progress counts every printing", () => {
  const owned = new Map([["a", new Map([["Normal", 2]])], ["b", new Map([["Holofoil", 1]])]]);
  const p = progress(cards, owned, true);
  assert.equal(p.have, 2);
  assert.equal(p.total, 5);
  assert.equal(p.costToComplete, 0.5 + 3);
});

const card = (id: string, dex: number, rank: number, price: number, owned = false): BinderCandidate => ({
  id, name: id, image: null, setId: "s", setName: "S", releaseDate: "2024-01-01", numberSort: 1, localId: "1",
  dexIds: [dex], rarityRank: rank, price, owned,
});

test("one per Pokédex number prefers the owned card, else the cheapest", () => {
  const cfg = binderConfig.parse({ source: "pokedex", excludeRares: true });
  const slots = planSlots(
    [card("pika-sir", 25, 90, 80, true), card("pika-c", 25, 10, 0.2), card("pika-u", 25, 20, 0.1), card("bulba", 1, 10, 0.3, true)],
    cfg,
    [{ dexId: 1, name: "Bulbasaur" }, { dexId: 2, name: "Ivysaur" }, { dexId: 25, name: "Pikachu" }],
  );
  assert.deepEqual(slots.map((s) => s.card?.id ?? s.label), ["bulba", "#2 Ivysaur", "pika-u"]);
  assert.deepEqual(slots.map((s) => s.owned), [true, false, false]);
});

test("pages fill to the layout and can break by generation", () => {
  const slots = Array.from({ length: 20 }, (_, i) => ({ key: `dex-${i + 145}`, card: null, owned: false }));
  assert.deepEqual(paginate(slots, 9, { breakPages: false, sort: "dex", source: "pokedex" }).map((p) => p.length), [9, 9, 2]);
  // 145-151 is Gen 1, 152+ Gen 2
  assert.deepEqual(paginate(slots, 9, { breakPages: true, sort: "dex", source: "pokedex" }).map((p) => p.length), [7, 9, 4]);
});

test("options that don't fit the binder type are dropped", () => {
  const cfg = binderConfig.parse({ source: "pokemon", dexId: 6, onePerPokemon: true, pokemonOnly: true, breakPages: true, noReprints: true, sort: "name" });
  const n = normalizeConfig(cfg);
  assert.equal(n.onePerPokemon, false);
  assert.equal(n.pokemonOnly, false);
  assert.equal(n.breakPages, false);
  assert.equal(n.noReprints, true);
  assert.equal(n.sort, "release"); // name isn't offered for one Pokémon
  const dex = normalizeConfig(binderConfig.parse({ source: "pokedex", sort: "value" }));
  assert.equal(dex.onePerPokemon, true);
  assert.equal(dex.sort, "dex");
});

test("skip reprints keeps the owned print, else the oldest", () => {
  const base = (id: string, date: string, owned: boolean, printKey: string | null): BinderCandidate => ({
    ...card(id, 6, 10, 1, owned), releaseDate: date, printKey,
  });
  const cfg = binderConfig.parse({ source: "pokemon", dexId: 6, noReprints: true, sort: "release" });
  const slots = planSlots(
    [base("dri", "2025-05-30", false, "k"), base("asc", "2026-01-30", true, "k"), base("old", "1999-01-09", false, "j"), base("new", "2020-01-01", false, "j"), base("solo", "2010-01-01", false, null)],
    cfg,
  );
  assert.deepEqual(slots.map((s) => s.card!.id).sort(), ["asc", "old", "solo"]);
});
