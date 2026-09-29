/**
 * What's new, newest first. Shown on /whats-new; a small dot on the "What's
 * new" link appears when there's an entry newer than the one the user last
 * saw. Add an entry whenever something visible ships.
 */
export interface Update {
  /** YYYY-MM-DD. Entries on the same day are fine. */
  date: string;
  title: string;
  items: string[];
  /** Where to try it. */
  link?: { to: string; label: string };
}

export const UPDATES: Update[] = [
  {
    date: "2026-09-29",
    title: "Wishlist, trades and sharing",
    items: [
      "Wishlist: tap ♡ Want on any card or empty binder pocket. Set a target price and it's flagged when the market gets there.",
      "Trade helper: put in both sides with each card's condition or grade and see if it's fair. Record it to update your collection.",
      "Share a binder or your whole collection with a read-only link. Off by default, and never shows what you paid.",
      "The dashboard shows this week's biggest risers and fallers in your collection.",
      "The scanner has an EN / JP switch for Japanese cards.",
    ],
    link: { to: "/wishlist", label: "Open your wishlist" },
  },
  {
    date: "2026-09-29",
    title: "Scan a whole binder",
    items: [
      "Live camera scanning: line a card up in the outline, tap Add, move to the next pocket.",
      "Much faster and pickier: it reads the name, the number and the set code, and checks them against each other.",
      "Pick the condition (M, NM, LP…) right from the scanner or the Add page. It remembers your last choice.",
      "Remove cards with one tap, or select several. Every removal can be undone.",
    ],
    link: { to: "/add/scan", label: "Try the scanner" },
  },
  {
    date: "2026-09-29",
    title: "Built for phones",
    items: [
      "A tab bar at the bottom on phones, with everything else under More.",
      "The collection has a compact list with values always visible, or a card grid.",
    ],
  },
  {
    date: "2026-09-28",
    title: "Sealed inventory",
    items: [
      "For people who buy and sell sealed product: log boxes, ETBs and tins with what you paid, record sales, and watch price charts with buy and sell signals.",
      "Off by default. Turn it on in Settings.",
    ],
    link: { to: "/settings", label: "Settings" },
  },
  {
    date: "2026-09-28",
    title: "Shadowless launches",
    items: [
      "Track cards by printing, condition and grade, see what they're worth, find the ones worth grading, and plan binders and master sets.",
    ],
  },
];

export const LATEST_UPDATE = UPDATES[0].date;
