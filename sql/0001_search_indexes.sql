-- ===========================================================================
-- Phase 6: search indexes for dataset_records
-- Paste this into the file created by:  npx drizzle-kit generate --custom --name=search_indexes
-- then run:                              npm run db:migrate
--
-- Why expression indexes?  Every record keeps its fields in the jsonb column "data".
-- The API always reads a field as (data->>'key'), so the index must use the SAME
-- expression, otherwise PostgreSQL cannot use it (see src/lib/records-query.ts).
-- ===========================================================================

-- pg_trgm: splits text into 3-letter pieces so  ILIKE '%mit%'  can use an index.
-- (PostgreSQL 13+ lets the database owner create it. On older/managed servers ask an admin.)
CREATE EXTENSION IF NOT EXISTS pg_trgm;
--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- A. TRIGRAM GIN indexes: global search and "contains" filters on free-text fields.
--    One index per text key. Rows of every dataset share these indexes, the query's
--    "dataset_id = ..." condition removes the other datasets afterwards.
-- ---------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS records_trgm_name_idx          ON dataset_records USING gin ((data->>'name') gin_trgm_ops);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS records_trgm_email_idx         ON dataset_records USING gin ((data->>'email') gin_trgm_ops);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS records_trgm_company_idx       ON dataset_records USING gin ((data->>'company') gin_trgm_ops);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS records_trgm_city_idx          ON dataset_records USING gin ((data->>'city') gin_trgm_ops);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS records_trgm_customer_id_idx   ON dataset_records USING gin ((data->>'customerId') gin_trgm_ops);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS records_trgm_sku_idx           ON dataset_records USING gin ((data->>'sku') gin_trgm_ops);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS records_trgm_brand_idx         ON dataset_records USING gin ((data->>'brand') gin_trgm_ops);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS records_trgm_order_number_idx  ON dataset_records USING gin ((data->>'orderNumber') gin_trgm_ops);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS records_trgm_customer_name_idx ON dataset_records USING gin ((data->>'customerName') gin_trgm_ops);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS records_trgm_product_name_idx  ON dataset_records USING gin ((data->>'productName') gin_trgm_ops);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS records_trgm_product_sku_idx   ON dataset_records USING gin ((data->>'productSku') gin_trgm_ops);
--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- B. COMPOSITE B-TREE indexes for exact filters ("status = Active", "country = Germany").
--    Order of columns: dataset_id first (every query has it), then the field, then id.
--    The trailing id keeps  ORDER BY id  (the default order and the tie-breaker) free,
--    so "Active customers, page 1" is read straight from the index in id order.
-- ---------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS records_ds_status_idx   ON dataset_records (dataset_id, (data->>'status'), id);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS records_ds_country_idx  ON dataset_records (dataset_id, (data->>'country'), id);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS records_ds_category_idx ON dataset_records (dataset_id, (data->>'category'), id);
--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- C. SORT / RANGE indexes. The expression and the sort direction must match what the
--    API writes:  ORDER BY (...) <dir> NULLS LAST, id ASC   (see buildRecordsQuery).
--    Numbers are cast to numeric exactly like the API does, so "revenue > 10000" and
--    "ORDER BY revenue" both use the same index. Dates are ISO text, so plain text order
--    is date order and "last N days" becomes a range scan on the same index.
-- ---------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS records_ds_revenue_desc_idx ON dataset_records (dataset_id, ((data->>'revenue')::numeric) DESC NULLS LAST, id);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS records_ds_revenue_asc_idx  ON dataset_records (dataset_id, ((data->>'revenue')::numeric) ASC NULLS LAST, id);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS records_ds_total_desc_idx   ON dataset_records (dataset_id, ((data->>'total')::numeric) DESC NULLS LAST, id);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS records_ds_price_desc_idx   ON dataset_records (dataset_id, ((data->>'price')::numeric) DESC NULLS LAST, id);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS records_ds_signup_idx       ON dataset_records (dataset_id, (data->>'signupDate') DESC NULLS LAST, id);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS records_ds_orderdate_idx    ON dataset_records (dataset_id, (data->>'orderDate') DESC NULLS LAST, id);
--> statement-breakpoint

-- Fresh statistics so the query planner chooses the new indexes correctly.
ANALYZE dataset_records;
