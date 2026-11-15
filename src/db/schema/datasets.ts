import {
  boolean,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
} from "drizzle-orm/pg-core";
import { users } from "./auth";
import { fieldTypeEnum, permissionLevelEnum } from "./enums";

// ---------------------------------------------------------------------------
// A dataset = one collection of records (e.g. "Customers").
// ---------------------------------------------------------------------------
export const datasets = pgTable(
  "datasets",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    name: text("name").notNull(),
    slug: text("slug").notNull().unique(),
    description: text("description"),
    category: text("category").notNull(),
    dataSource: text("data_source").notNull(),
    // Cached counter so the library page does not need COUNT(*) on millions of rows.
    totalRecords: integer("total_records").notNull().default(0),
    createdBy: text("created_by").references(() => users.id, {
      onDelete: "set null",
    }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (t) => [index("datasets_category_idx").on(t.category)],
);

// ---------------------------------------------------------------------------
// The "columns" of a dataset. The Explorer builds table columns and filters
// dynamically from these rows.
// ---------------------------------------------------------------------------
export const datasetFields = pgTable(
  "dataset_fields",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    datasetId: uuid("dataset_id")
      .notNull()
      .references(() => datasets.id, { onDelete: "cascade" }),
    // key = property name inside dataset_records.data (e.g. "country")
    key: text("key").notNull(),
    label: text("label").notNull(),
    type: fieldTypeEnum("type").notNull().default("text"),
    isSearchable: boolean("is_searchable").notNull().default(true),
    isFilterable: boolean("is_filterable").notNull().default(true),
    isSortable: boolean("is_sortable").notNull().default(true),
    isVisibleByDefault: boolean("is_visible_by_default").notNull().default(true),
    position: integer("position").notNull().default(0),
    // For type = "select": the allowed values, e.g. ["Active","Inactive"]
    options: jsonb("options").$type<string[]>(),
  },
  (t) => [
    unique("dataset_fields_dataset_key_uq").on(t.datasetId, t.key),
    index("dataset_fields_dataset_idx").on(t.datasetId),
  ],
);

// ---------------------------------------------------------------------------
// Dataset-level permissions (who can open which dataset, and how far).
// Admins bypass this table; analysts and viewers need a row here.
// ---------------------------------------------------------------------------
export const accessPermissions = pgTable(
  "access_permissions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    datasetId: uuid("dataset_id")
      .notNull()
      .references(() => datasets.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    level: permissionLevelEnum("level").notNull().default("read"),
    grantedBy: text("granted_by").references(() => users.id, {
      onDelete: "set null",
    }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    unique("access_permissions_dataset_user_uq").on(t.datasetId, t.userId),
    index("access_permissions_user_idx").on(t.userId),
  ],
);
