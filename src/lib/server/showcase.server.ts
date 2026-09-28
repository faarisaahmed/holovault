import { cardsByIds } from "./catalog.server";
import type { Showcase } from "@/components/auth-shell";

/** Chase cards for the sign-in page: Moonbreon, the 151 Charizard ex SIR, Base Set Charizard. */
const IDS = ["sv03.5-199", "swsh7-215", "base1-4"];

export function showcaseCards(): Showcase[] {
  const cards = cardsByIds(IDS);
  return IDS.map((id) => cards.get(id))
    .filter((c): c is NonNullable<typeof c> => !!c?.image)
    .map((c) => ({ id: c.id, name: c.name, image: c.image! }));
}
