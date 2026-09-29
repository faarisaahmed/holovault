# Shadowless

*Know what your collection is worth.*

A Pokémon TCG collection tracker: add cards by printing, condition and grade, see what they're worth, find
the ones worth grading, track sets and Pokémon to completion, and plan binder layouts. Sibling to
[Ripwise](https://github.com/faarisaahmed/pokemon-pull-tracker), whose card catalog and price pipeline it
shares.

## Features

- **Add cards fast** (`/add`) — search by name, set or number (`charizard 151`, `umbreon 215`,
  `sv03.5 199`). One-click buttons add a copy in each printing the card exists in (Normal, Holo, Reverse, 1st
  Edition…) in your default condition; click a card for condition (Mint → Damaged), grading company and grade,
  cert number, quantity and price paid. Every add can be undone.
- **Scan cards** (`/add/scan`) — **live camera** for binders: only the card inside the on-screen outline is
  read, each match pops up to confirm with one tap, and after an add it waits until the view changes (you moved
  to the next pocket) before reading again. Or take a photo (or pick a batch) and tap the match. Text is read on the device
  with Tesseract (served from `/ocr`, copied in by `npm run ocr`); the name and collector number (`199/165`)
  find the card, and the photo's colours pick between printings of the same name. Photos are never uploaded.
  An EN / JP switch reads Japanese names with the Japanese model (`public/ocr/jpn.traineddata.gz`, loaded only
  when chosen). Attack names (fetched from TCGdex GraphQL at ingest, `cards.moves`) identify cards whose titles
  won't read.
- **Wishlist** (`/wishlist`) — tap ♡ Want on any card (Add cards, empty binder pockets). Shows today's price,
  the change since you added it, and flags cards under your target price or down 10%+. "Got it" moves one into
  the collection.
- **Trade helper** (`/trade`) — both sides with printing and condition (or grader and grade) per card, valued at
  market with condition discounts or PSA comps; a fairness bar; "Record trade" takes your copies out and adds
  what you got.
- **Sharing** — optional read-only links for a binder (`/s/b/…`) or the whole collection (`/s/c/…`, values
  optional). Off by default; turning off retires the link. Never shows prices paid, notes or account details.
- **Price moves** — the dashboard's "This week" lists your biggest risers and fallers. Card prices for anything
  owned or wanted are recorded daily by `npm run snapshot` (`card_price`), since no free history exists.
- **Collection** (`/collection`) — every copy with its value, filterable and sortable, editable in place,
  including your own valuation. Identical copies merge into one row with a quantity.
- **Value** — TCGplayer market prices per printing, refreshed daily. Played cards take a typical TCGplayer
  condition discount (shown as an estimate). PSA slabs use PSA sold prices when available. The dashboard shows
  total value, gain against price paid, value by set and the most valuable cards.
- **Worth grading?** (`/grading`) — for raw Mint / Near Mint cards: *grade* when even a PSA 9 sells for more than
  the raw card plus your grading and shipping costs; *only if it 10s* when just a PSA 10 would; otherwise the
  break-even price a slab would need. Graded prices come from Ripwise's eBay comps
  (`RIPWISE_URL`), cached for a week.
- **Sets** (`/sets`, `/sets/:id`) — completion for every set you own or track, as a set (one of each card) and as
  a master set (every printing), with the market cost to finish. The checklist dims what you're missing; click a
  printing to add it.
- **Pokémon** (`/pokemon`) — every card of one Pokémon (by Pokédex number, so forms and tag teams count), with
  filters for no rares and no straight reprints, and progress for the ones you track.
- **Binders** (`/binders`) — plan a binder in 2×2 to 4×4 pages from your collection, the whole Pokédex, a set or
  one Pokémon; sort by Pokédex number, set, name, value or rarity; no rares, one per Pokémon, Pokémon only, new
  page per set / generation. Owned pockets show your card; empty ones show what to look for.
- **Sealed inventory** (`/sealed`, opt-in from Settings) — for people who buy and sell sealed product. Every
  booster box, ETB, bundle, pack, blister, tin, collection, UPC, case and display TCGplayer lists; log purchases
  as lots (quantity, price paid, date), record sales (price, fees), and see value, cost, unrealized and realized
  profit. A watchlist, a price chart per product with your average cost on it, and plain-rule buy / sell signals
  from the product's own last 90 days (near its low and steady → buy; near its high and well above your cost →
  sell), each shown with its reasoning. Off by default, so casual collectors never see it.
- **Import** (`/import`) — a faster way to add cards you already have listed: a CSV from your own spreadsheet or
  another app. Columns are detected (name, set, number, quantity, condition, printing, grade, price paid,
  TCGplayer product ID) and you see what matched before anything is added.
- **Settings** (`/settings`) — name, password, Google linking, signing out other devices, grading costs,
  defaults, CSV / JSON export and account deletion.

## Accounts and security

Authentication is [Better Auth](https://www.better-auth.com) (`src/lib/server/auth.server.ts`):

- Email + password (10–128 characters, hashed with scrypt) and optional Google sign-in.
- Sessions are httpOnly cookies (`Secure` in production), 30 days, refreshed daily. Changing or resetting a
  password signs out every other device.
- Sign-in, sign-up and reset routes are rate-limited per IP. Failed sign-ins give one generic message, and reset
  requests the same answer whether or not the email exists, so neither reveals who has an account.
- Google never silently joins an existing password account (the pre-registration takeover): linking is explicit,
  from Settings, while signed in.
- With email configured (`RESEND_API_KEY`), new password accounts must verify their address and can reset a
  forgotten password.
- Post-login redirects only go to same-site paths.
- Every collection query filters on the signed-in user's id, taken from the session, never from the request.
- Security headers on every page (CSP, HSTS, `X-Frame-Options: DENY`, `nosniff`, a strict referrer policy).
- CSV exports neutralise spreadsheet formulas.
- No analytics, no ads, no telemetry (Better Auth's is explicitly off). Deleting the account deletes the
  collection, binders and settings with it.

## Data

| What | Where | Notes |
|---|---|---|
| Card catalog, prices | SQLite (`data/pokemon.db`) | Rebuilt each deploy by `npm run ingest` — TCGdex + TCGCSV, same pipeline as Ripwise. Not in git. |
| Accounts, collections, binders | Postgres (`DATABASE_URL`) | Schema in `src/lib/server/schema.ts`, migrations in `drizzle/`. |
| Sealed price history | Postgres (`sealed_price`) | One row per sealed product per day, recorded by `npm run snapshot` after each ingest. No free historical source exists (TCGCSV's archive is offline), so charts start from the first recorded day and signals need 14 days. |
| PSA sold prices | Postgres cache | From Ripwise's `/api/psa/:cardId`, a week at a time. |

Locally, with no `DATABASE_URL`, an embedded Postgres ([PGlite](https://pglite.dev)) in `data/userdb` is created
and migrated automatically.

## Setup

```bash
npm install
npm run ingest   # builds data/pokemon.db (~1 minute)
npm run dev
```

Open http://localhost:5173 and create an account.

The app was called Holovault before it was renamed to Shadowless; the GitHub repo (`holovault`) keeps that
name so the Render deployment stays connected. The Render service in `render.yaml` is still named `card-tracker`, so the site lives at
`card-tracker.onrender.com`; rename the service there if you ever want the address to match.

| Script | Does |
|---|---|
| `npm run dev` / `build` / `start` | Dev server, production build, production server. |
| `npm run ingest` | Rebuild the card catalog and prices. |
| `npm run db:migrate` | Apply migrations to the user database. |
| `npm test` | Unit tests (valuation, grading, progress, binders, CSV import, rarity rules). |
| `npm run typecheck` / `lint` | Types and lint. |

## Deploying (Render)

1. Create a free Postgres database on [Neon](https://neon.tech) and copy its connection string.
2. On Render, create a Blueprint from this repo (`render.yaml`). Set `DATABASE_URL` and `BETTER_AUTH_URL` (the
   site's public URL). `BETTER_AUTH_SECRET` is generated for you.
3. Optional: Google sign-in — create an OAuth client in Google Cloud with the redirect URI
   `<BETTER_AUTH_URL>/api/auth/callback/google`, then set `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET`.
4. Optional: email verification and password reset — a [Resend](https://resend.com) key in `RESEND_API_KEY` and a
   verified sender in `EMAIL_FROM`.
5. Optional: graded prices — `RIPWISE_URL` pointing at the Ripwise deployment.
6. For daily price updates **and the sealed price history**, add the Render deploy hook as the
   `RENDER_DEPLOY_HOOK` repository secret; `.github/workflows/refresh-prices.yml` calls it every day, and each
   rebuild records that day's sealed prices. Without it, prices only update (and history only grows) when you push.

## Licence

Code is MIT — see [LICENSE](LICENSE). Card data, prices and images are not covered by it; see
[NOTICE.md](NOTICE.md). Keep it non-commercial and never commit `data/*.db`.
