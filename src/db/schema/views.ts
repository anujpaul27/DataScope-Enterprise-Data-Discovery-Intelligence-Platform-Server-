import {
  bigint,
  boolean,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";
import { users } from "./auth";
import { datasets } from "./datasets";

// ---------------------------------------------------------------------------
// Saved views: a reusable Explorer configuration.
// The exact shape of `conditions` / `sort` is defined in Phase 6 (Zod schema);
// until then they are stored as generic JSON arrays.
// ---------------------------------------------------------------------------
export const savedViews = pgTable(
  "saved_views",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    datasetId: uuid("dataset_id")
      .notNull()
      .references(() => datasets.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    globalSearch: text("global_search"),
    // Filters + field-based search conditions (all combined with AND/OR)
    conditions: jsonb("conditions").$type<unknown[]>().notNull().default([]),
    sort: jsonb("sort").$type<unknown[]>().notNull().default([]),
    visibleColumns: jsonb("visible_columns")
      .$type<string[]>()
      .notNull()
      .default([]),
    // true = also visible to the people listed in saved_view_shares
    isShared: boolean("is_shared").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (t) => [
    index("saved_views_user_idx").on(t.userId),
    index("saved_views_dataset_idx").on(t.datasetId),
  ],
);

// Who a view is shared with (team members).
export const savedViewShares = pgTable(
  "saved_view_shares",
  {
    viewId: uuid("view_id")
      .notNull()
      .references(() => savedViews.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.viewId, t.userId] }),
    index("saved_view_shares_user_idx").on(t.userId),
  ],
);

// ---------------------------------------------------------------------------
// Recently executed searches. durationMs/resultCount also feed the analytics
// ("search activity", "most used filters") and the performance dashboard.
// ---------------------------------------------------------------------------
export const searchHistory = pgTable(
  "search_history",
  {
    id: bigint("id", { mode: "number" }).primaryKey().generatedAlwaysAsIdentity(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    datasetId: uuid("dataset_id")
      .notNull()
      .references(() => datasets.id, { onDelete: "cascade" }),
    globalSearch: text("global_search"),
    conditions: jsonb("conditions").$type<unknown[]>().notNull().default([]),
    sort: jsonb("sort").$type<unknown[]>().notNull().default([]),
    resultCount: integer("result_count"),
    durationMs: integer("duration_ms"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index("search_history_user_created_idx").on(t.userId, t.createdAt),
    index("search_history_dataset_created_idx").on(t.datasetId, t.createdAt),
  ],
);

// ---------------------------------------------------------------------------
// Per-user UI settings (one row per user).
// ---------------------------------------------------------------------------
export const userPreferences = pgTable("user_preferences", {
  userId: text("user_id")
    .primaryKey()
    .references(() => users.id, { onDelete: "cascade" }),
  theme: text("theme").notNull().default("system"),
  defaultPageSize: integer("default_page_size").notNull().default(25),
  // e.g. { "<datasetId>": ["name","country","revenue"] }
  columnPreferences: jsonb("column_preferences")
    .$type<Record<string, string[]>>()
    .notNull()
    .default({}),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
});
