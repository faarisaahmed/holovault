import { getDb } from "../../src/lib/db.server";

/**
 * Attack and ability names for every English Pokémon card, for the scanner:
 * when a title won't read, "Moon Mirage" still says Umbreon ex. TCGdex's
 * GraphQL list returns them 500 at a time (its REST set pages don't).
 */
const URL = "https://api.tcgdex.net/v2/graphql";
const PAGE = 500;

interface Row {
  id: string;
  attacks: ({ name: string } | null)[] | null;
  abilities: ({ name: string } | null)[] | null;
}

async function page(n: number, attempt = 0): Promise<Row[]> {
  const query = `{ cards(filters: {category: "Pokemon"}, pagination: {page: ${n}, itemsPerPage: ${PAGE}}) { id attacks { name } abilities { name } } }`;
  try {
    const res = await fetch(URL, {
      method: "POST",
      headers: { "content-type": "application/json", "User-Agent": "Shadowless/0.1 (personal collection tracker)" },
      body: JSON.stringify({ query }),
    });
    if (!res.ok) throw new Error(`${res.status}`);
    const json = (await res.json()) as { data?: { cards: Row[] | null } };
    return json.data?.cards ?? [];
  } catch (err) {
    if (attempt >= 3) throw err;
    await new Promise((r) => setTimeout(r, 2000 * (attempt + 1)));
    return page(n, attempt + 1);
  }
}

export async function ingestMoves() {
  console.log("\n== moves (scanner) ==");
  const db = getDb();
  const update = db.prepare(`UPDATE cards SET moves = ? WHERE id = ?`);
  let total = 0;
  for (let n = 1; n < 200; n++) {
    const rows = await page(n);
    if (!rows.length) break;
    db.transaction(() => {
      for (const r of rows) {
        const names = [...(r.attacks ?? []), ...(r.abilities ?? [])].map((m) => m?.name).filter((n): n is string => !!n);
        if (names.length) update.run(names.join(" | "), r.id);
      }
    })();
    total += rows.length;
    process.stdout.write(`\r  pokemon cards: ${total}`);
  }
  // Standalone subset copies ("<id>@<subset>") share their card's moves.
  db.exec(`UPDATE cards SET moves = (SELECT b.moves FROM cards b WHERE b.id = substr(cards.id, 1, instr(cards.id, '@') - 1))
           WHERE instr(id, '@') > 0`);
  console.log("");
}
