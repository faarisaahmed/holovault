import { sql } from "drizzle-orm";
import {
  boolean,
  date,
  index,
  integer,
  jsonb,
  numeric,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";

/*
 * User data lives in Postgres; the card catalog is a read-only SQLite file
 * rebuilt on every deploy (see catalog.server.ts). Every table here is keyed
 * to a user and every query filters on user_id.
 */

// ---------------------------------------------------------------- auth
// Better Auth's core tables (https://www.better-auth.com/docs/concepts/database).

export const user = pgTable("user", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  email: text("email").notNull().unique(),
  emailVerified: boolean("email_verified").notNull().default(false),
  image: text("image"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const session = pgTable(
  "session",
  {
    id: text("id").primaryKey(),
    expiresAt: timestamp("expires_at").notNull(),
    token: text("token").notNull().unique(),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
    ipAddress: text("ip_address"),
    userAgent: text("user_agent"),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
  },
  (t) => [index("session_user_idx").on(t.userId)],
);

export const account = pgTable(
  "account",
  {
    id: text("id").primaryKey(),
    accountId: text("account_id").notNull(),
    providerId: text("provider_id").notNull(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    accessToken: text("access_token"),
    refreshToken: text("refresh_token"),
    idToken: text("id_token"),
    accessTokenExpiresAt: timestamp("access_token_expires_at"),
    refreshTokenExpiresAt: timestamp("refresh_token_expires_at"),
    scope: text("scope"),
    password: text("password"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (t) => [index("account_user_idx").on(t.userId)],
);

export const verification = pgTable("verification", {
  id: text("id").primaryKey(),
  identifier: text("identifier").notNull(),
  value: text("value").notNull(),
  expiresAt: timestamp("expires_at").notNull(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

// ---------------------------------------------------------- collection

/**
 * One row per distinct copy-type a user owns: the same card in the same
 * finish, condition and grade is one row with a quantity.
 */
export const collectionItem = pgTable(
  "collection_item",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    /** Catalog card id (TCGdex), e.g. "sv03.5-199". */
    cardId: text("card_id").notNull(),
    /** TCGplayer printing: "Normal", "Holofoil", "Reverse Holofoil", "1st Edition Holofoil"... */
    finish: text("finish").notNull(),
    /** Raw condition: M, NM, LP, MP, HP, DMG. Null when graded. */
    condition: text("condition"),
    /** Grading company (PSA, BGS, CGC, TAG, ACE) and grade, when slabbed. */
    grader: text("grader"),
    grade: numeric("grade", { precision: 3, scale: 1 }),
    certNumber: text("cert_number"),
    quantity: integer("quantity").notNull().default(1),
    /** What was paid per copy, in cents. */
    purchaseCents: integer("purchase_cents"),
    /** The owner's own valuation per copy, overriding market data. */
    valueOverrideCents: integer("value_override_cents"),
    acquiredOn: text("acquired_on"),
    notes: text("notes"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (t) => [
    index("collection_user_idx").on(t.userId),
    index("collection_user_card_idx").on(t.userId, t.cardId),
  ],
);

/** Sets and Pokémon a user has chosen to track progress on. */
export const goal = pgTable(
  "goal",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    /** "set" (target = set id) or "species" (target = Pokedex number). */
    kind: text("kind").notNull(),
    target: text("target").notNull(),
    /** Master set (every printing) or just one of each card. */
    master: boolean("master").notNull().default(false),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => [index("goal_user_idx").on(t.userId)],
);

/** A saved binder layout: which cards, in what order, on pages of rows x cols. */
export const binder = pgTable(
  "binder",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    rows: integer("rows").notNull().default(3),
    cols: integer("cols").notNull().default(3),
    /** BinderConfig, validated on read (see binder.ts). */
    config: jsonb("config").notNull().default(sql`'{}'::jsonb`),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (t) => [index("binder_user_idx").on(t.userId)],
);

export const userSettings = pgTable("user_settings", {
  userId: text("user_id")
    .primaryKey()
    .references(() => user.id, { onDelete: "cascade" }),
  /** Per-card grading fee plus the share of shipping and insurance, in cents. */
  gradingFeeCents: integer("grading_fee_cents").notNull().default(2500),
  gradingShippingCents: integer("grading_shipping_cents").notNull().default(500),
  defaultCondition: text("default_condition").notNull().default("NM"),
  defaultRegion: text("default_region").notNull().default("en"),
  /** Opt-in sealed inventory (for people who buy and sell sealed product). */
  sealedEnabled: boolean("sealed_enabled").notNull().default(false),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

/** Graded sold prices, cached from Ripwise's eBay comps for a week. */
export const gradedPrice = pgTable(
  "graded_price",
  {
    cardId: text("card_id").notNull(),
    grade: text("grade").notNull(),
    avgPrice: numeric("avg_price", { precision: 10, scale: 2 }).notNull(),
    salesCount: integer("sales_count").notNull(),
    fetchedAt: timestamp("fetched_at").notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.cardId, t.grade] })],
);

/** When a card's graded comps were last looked up, including empty results. */
export const gradedFetch = pgTable("graded_fetch", {
  cardId: text("card_id").primaryKey(),
  status: text("status").notNull(),
  fetchedAt: timestamp("fetched_at").notNull().defaultNow(),
});

// ---------------------------------------------------------------- sealed

/** One purchase of a sealed product: how many, at what price, when. */
export const sealedLot = pgTable(
  "sealed_lot",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    /** TCGplayer product id (see the catalog's sealed_catalog table). */
    productId: integer("product_id").notNull(),
    quantity: integer("quantity").notNull(),
    /** Price paid per unit, in cents, including tax and shipping if you like. */
    unitCostCents: integer("unit_cost_cents").notNull(),
    boughtOn: date("bought_on"),
    notes: text("notes"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => [index("sealed_lot_user_idx").on(t.userId), index("sealed_lot_user_product_idx").on(t.userId, t.productId)],
);

/** A sale of sealed product, which takes units out of the holding. */
export const sealedSale = pgTable(
  "sealed_sale",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    productId: integer("product_id").notNull(),
    quantity: integer("quantity").notNull(),
    /** Sale price per unit, in cents. */
    unitPriceCents: integer("unit_price_cents").notNull(),
    /** Platform fees and shipping paid, for the whole sale, in cents. */
    feesCents: integer("fees_cents").notNull().default(0),
    soldOn: date("sold_on"),
    notes: text("notes"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => [index("sealed_sale_user_idx").on(t.userId)],
);

/** Products a user is watching for a good time to buy. */
export const sealedWatch = pgTable(
  "sealed_watch",
  {
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    productId: integer("product_id").notNull(),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.userId, t.productId] })],
);

/**
 * Daily market prices for sealed product, recorded by each price refresh
 * (no free historical source exists). Not user data: shared by everyone.
 */
export const sealedPrice = pgTable(
  "sealed_price",
  {
    productId: integer("product_id").notNull(),
    day: date("day").notNull(),
    market: numeric("market", { precision: 10, scale: 2 }),
    low: numeric("low", { precision: 10, scale: 2 }),
  },
  (t) => [primaryKey({ columns: [t.productId, t.day] })],
);
