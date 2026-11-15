import {
  bigint,
  index,
  jsonb,
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
} from "drizzle-orm/pg-core";
import { users } from "./auth";
import { datasets } from "./datasets";

// ---------------------------------------------------------------------------
// One row per record. Fields live in the `data` jsonb column so a single table
// can hold any dataset (Customers, Orders, ...) and fields stay dynamic.
// bigint identity (not uuid) keeps the primary key small and sortable, which
// matters for fast pagination on millions of rows.
// ---------------------------------------------------------------------------
export const datasetRecords = pgTable(
  "dataset_records",
  {
    id: bigint("id", { mode: "number" }).primaryKey().generatedAlwaysAsIdentity(),
    datasetId: uuid("dataset_id")
      .notNull()
      .references(() => datasets.id, { onDelete: "cascade" }),
    data: jsonb("data").$type<Record<string, unknown>>().notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (t) => [
    // Every query starts with "WHERE dataset_id = ?", then pages by id.
    index("records_dataset_id_idx").on(t.datasetId, t.id),
    // "newest records first" / date-range filters on created date.
    index("records_dataset_created_idx").on(t.datasetId, t.createdAt),
    // Generic jsonb containment index; Phase 6 adds FTS + trigram + per-field indexes.
    index("records_data_gin_idx").using("gin", t.data),
  ],
);

// ---------------------------------------------------------------------------
// Link between two records (e.g. Customer -> Order).
// ---------------------------------------------------------------------------
export const recordRelationships = pgTable(
  "record_relationships",
  {
    id: bigint("id", { mode: "number" }).primaryKey().generatedAlwaysAsIdentity(),
    sourceRecordId: bigint("source_record_id", { mode: "number" })
      .notNull()
      .references(() => datasetRecords.id, { onDelete: "cascade" }),
    targetRecordId: bigint("target_record_id", { mode: "number" })
      .notNull()
      .references(() => datasetRecords.id, { onDelete: "cascade" }),
    relationType: text("relation_type").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    unique("record_relationships_uq").on(
      t.sourceRecordId,
      t.targetRecordId,
      t.relationType,
    ),
    index("record_relationships_source_idx").on(t.sourceRecordId),
    index("record_relationships_target_idx").on(t.targetRecordId),
  ],
);

// ---------------------------------------------------------------------------
// "Historical changes" shown on the record detail page.
// changes example: { "status": { "from": "Active", "to": "Inactive" } }
// ---------------------------------------------------------------------------
export const recordHistory = pgTable(
  "record_history",
  {
    id: bigint("id", { mode: "number" }).primaryKey().generatedAlwaysAsIdentity(),
    recordId: bigint("record_id", { mode: "number" })
      .notNull()
      .references(() => datasetRecords.id, { onDelete: "cascade" }),
    changedBy: text("changed_by").references(() => users.id, {
      onDelete: "set null",
    }),
    changes: jsonb("changes")
      .$type<Record<string, { from: unknown; to: unknown }>>()
      .notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [index("record_history_record_idx").on(t.recordId, t.createdAt)],
);
