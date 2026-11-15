import { eq, inArray, sql } from "drizzle-orm";
import { db, pool } from "../index";
import {
  datasetFields,
  datasetRecords,
  datasets,
  recordHistory,
  recordRelationships,
} from "../schema";
import {
  ALL_SLUGS,
  CUSTOMERS_SLUG,
  DatasetDef,
  ORDERS_SLUG,
  PRODUCTS_SLUG,
  customersDef,
  ordersDef,
  productsDef,
} from "./definitions";
import {
  CustomerRef,
  GeneratedRecord,
  ProductRef,
  makeCustomer,
  makeOrder,
  makeProduct,
} from "./generators";
import { createRng, int, pick, weighted } from "./random";
import { CUSTOMER_STATUS_WEIGHTS } from "./data";

// ---------------------------------------------------------------------------
// Usage (from the backend folder):
//   npm run db:seed -- --reset                  (default: 100,000 customers)
//   npm run db:seed -- --customers=1000 --reset (small quick test)
//   npm run db:seed -- --customers=500000 --reset  (bigger performance test)
// Optional: --products=2000  --orders-per-customer=1.5  --seed=42
// ---------------------------------------------------------------------------

function numArg(name: string, fallback: number): number {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  if (!hit) return fallback;
  const value = Number(hit.split("=")[1]);
  if (!Number.isFinite(value) || value <= 0) {
    throw new Error(`--${name} must be a positive number`);
  }
  return value;
}

const RESET = process.argv.includes("--reset");
const CUSTOMER_COUNT = Math.floor(numArg("customers", 100_000));
const PRODUCT_COUNT = Math.floor(numArg("products", 2_000));
const ORDERS_PER_CUSTOMER = numArg("orders-per-customer", 1.5);
const ORDER_COUNT = Math.floor(CUSTOMER_COUNT * ORDERS_PER_CUSTOMER);
const SEED = Math.floor(numArg("seed", 42));

// Rows per INSERT. PostgreSQL allows 65,535 parameters per statement and each
// record uses 4, so 2,000 rows (= 8,000 params) is safely below the limit.
const RECORD_BATCH = 2_000;
const SMALL_BATCH = 5_000;

function progress(label: string, done: number, total: number): void {
  const pct = Math.round((done / total) * 100);
  process.stdout.write(`\r  ${label}: ${done.toLocaleString()} / ${total.toLocaleString()} (${pct}%)   `);
  if (done >= total) process.stdout.write("\n");
}

async function createDataset(def: DatasetDef): Promise<string> {
  const [row] = await db
    .insert(datasets)
    .values({
      name: def.name,
      slug: def.slug,
      description: def.description,
      category: def.category,
      dataSource: def.dataSource,
    })
    .returning({ id: datasets.id });

  await db.insert(datasetFields).values(
    def.fields.map((f, position) => ({
      datasetId: row.id,
      key: f.key,
      label: f.label,
      type: f.type,
      options: f.options ?? null,
      isSearchable: f.isSearchable ?? true,
      isFilterable: f.isFilterable ?? true,
      isSortable: f.isSortable ?? true,
      isVisibleByDefault: f.isVisibleByDefault ?? true,
      position,
    })),
  );
  return row.id;
}

// Inserts records in batches and returns their new database ids in the same
// order as the input array (needed to create relationships afterwards).
async function insertRecords(
  label: string,
  datasetId: string,
  records: GeneratedRecord[],
): Promise<number[]> {
  const ids: number[] = [];
  for (let i = 0; i < records.length; i += RECORD_BATCH) {
    const chunk = records.slice(i, i + RECORD_BATCH);
    const inserted = await db
      .insert(datasetRecords)
      .values(
        chunk.map((r) => ({
          datasetId,
          data: r.data,
          createdAt: r.createdAt,
          updatedAt: r.updatedAt,
        })),
      )
      .returning({ id: datasetRecords.id });
    for (const row of inserted) ids.push(row.id);
    progress(label, Math.min(i + RECORD_BATCH, records.length), records.length);
  }
  return ids;
}

async function main(): Promise<void> {
  const startedAt = Date.now();
  const rng = createRng(SEED);
  const now = new Date();

  console.log("DataScope seed");
  console.log(
    `  customers=${CUSTOMER_COUNT.toLocaleString()} products=${PRODUCT_COUNT.toLocaleString()} orders=${ORDER_COUNT.toLocaleString()} seed=${SEED}`,
  );

  // ---- 0. existing data? ---------------------------------------------------
  const existing = await db
    .select({ slug: datasets.slug })
    .from(datasets)
    .where(inArray(datasets.slug, ALL_SLUGS));

  if (existing.length > 0) {
    if (!RESET) {
      console.log(
        `\nDatasets already exist (${existing.map((e) => e.slug).join(", ")}).\nRun again with --reset to delete and recreate them:\n  npm run db:seed -- --reset`,
      );
      return;
    }
    console.log("\nResetting old seed data (this cascades to records)...");
    await db.delete(datasets).where(inArray(datasets.slug, ALL_SLUGS));
  }

  // ---- 1. datasets + fields ------------------------------------------------
  console.log("\nCreating datasets and fields...");
  const customersId = await createDataset(customersDef);
  const productsId = await createDataset(productsDef);
  const ordersId = await createDataset(ordersDef);

  // ---- 2. customers --------------------------------------------------------
  console.log("\nGenerating customers...");
  const customerRecords: GeneratedRecord[] = [];
  for (let i = 0; i < CUSTOMER_COUNT; i++) customerRecords.push(makeCustomer(rng, i, now));
  const customerIds = await insertRecords("customers", customersId, customerRecords);

  // ---- 3. products ---------------------------------------------------------
  console.log("\nGenerating products...");
  const productRecords: GeneratedRecord[] = [];
  for (let i = 0; i < PRODUCT_COUNT; i++) productRecords.push(makeProduct(rng, i, now));
  const productIds = await insertRecords("products", productsId, productRecords);

  // ---- 4. orders + relationships ------------------------------------------
  console.log("\nGenerating orders...");
  const customerRefs: CustomerRef[] = customerRecords.map((r, i) => ({
    recordId: customerIds[i],
    customerId: String(r.data.customerId),
    name: String(r.data.name),
    createdAt: r.createdAt,
  }));
  const productRefs: ProductRef[] = productRecords.map((r, i) => ({
    recordId: productIds[i],
    sku: String(r.data.sku),
    name: String(r.data.name),
    price: Number(r.data.price),
  }));

  const orderRecords: GeneratedRecord[] = [];
  const orderCustomerIdx: number[] = [];
  const orderProductIdx: number[] = [];
  for (let i = 0; i < ORDER_COUNT; i++) {
    // power curve => some customers order a lot, many order rarely
    const cIdx = Math.floor(Math.pow(rng(), 1.4) * customerRefs.length);
    const pIdx = Math.floor(rng() * productRefs.length);
    orderCustomerIdx.push(cIdx);
    orderProductIdx.push(pIdx);
    orderRecords.push(makeOrder(rng, i, now, customerRefs[cIdx], productRefs[pIdx]));
  }
  const orderIds = await insertRecords("orders", ordersId, orderRecords);

  console.log("\nLinking orders to customers and products...");
  const relationRows: { sourceRecordId: number; targetRecordId: number; relationType: string }[] = [];
  for (let i = 0; i < orderIds.length; i++) {
    relationRows.push({
      sourceRecordId: orderIds[i],
      targetRecordId: customerRefs[orderCustomerIdx[i]].recordId,
      relationType: "placed_by",
    });
    relationRows.push({
      sourceRecordId: orderIds[i],
      targetRecordId: productRefs[orderProductIdx[i]].recordId,
      relationType: "contains",
    });
  }
  for (let i = 0; i < relationRows.length; i += SMALL_BATCH) {
    await db.insert(recordRelationships).values(relationRows.slice(i, i + SMALL_BATCH));
    progress("relationships", Math.min(i + SMALL_BATCH, relationRows.length), relationRows.length);
  }

  // ---- 5. sample change history (about 5% of customers) --------------------
  console.log("\nCreating sample change history...");
  const historyRows: {
    recordId: number;
    changes: Record<string, { from: unknown; to: unknown }>;
    createdAt: Date;
  }[] = [];
  for (let i = 0; i < customerRecords.length; i++) {
    if (rng() >= 0.05) continue;
    const rec = customerRecords[i];
    let currentStatus = String(rec.data.status);
    const changeCount = int(rng, 1, 3);
    for (let c = 0; c < changeCount; c++) {
      const nextStatus = weighted(rng, CUSTOMER_STATUS_WEIGHTS);
      if (nextStatus === currentStatus) continue;
      const span = Math.max(now.getTime() - rec.createdAt.getTime(), 1);
      historyRows.push({
        recordId: customerIds[i],
        changes: { status: { from: currentStatus, to: nextStatus } },
        createdAt: new Date(rec.createdAt.getTime() + Math.floor(rng() * span)),
      });
      currentStatus = nextStatus;
    }
    // sometimes the plan changed too
    if (rng() < 0.3) {
      historyRows.push({
        recordId: customerIds[i],
        changes: { plan: { from: String(rec.data.plan), to: pick(rng, ["Pro", "Business", "Enterprise"]) } },
        createdAt: new Date(rec.createdAt.getTime() + Math.floor(rng() * (now.getTime() - rec.createdAt.getTime() + 1))),
      });
    }
  }
  for (let i = 0; i < historyRows.length; i += SMALL_BATCH) {
    await db.insert(recordHistory).values(historyRows.slice(i, i + SMALL_BATCH));
  }
  console.log(`  history rows: ${historyRows.length.toLocaleString()}`);

  // ---- 6. totals + planner statistics -------------------------------------
  console.log("\nUpdating dataset totals...");
  await db.update(datasets).set({ totalRecords: customerRecords.length }).where(eq(datasets.id, customersId));
  await db.update(datasets).set({ totalRecords: productRecords.length }).where(eq(datasets.id, productsId));
  await db.update(datasets).set({ totalRecords: orderRecords.length }).where(eq(datasets.id, ordersId));

  // ANALYZE refreshes PostgreSQL's table statistics so the query planner picks
  // good plans (important before measuring query speed).
  console.log("Running ANALYZE (refresh planner statistics)...");
  await db.execute(sql`ANALYZE dataset_records`);
  await db.execute(sql`ANALYZE record_relationships`);

  // ---- 7. verify -----------------------------------------------------------
  const counts = await db
    .select({
      slug: datasets.slug,
      records: sql<number>`count(${datasetRecords.id})::int`,
    })
    .from(datasets)
    .leftJoin(datasetRecords, eq(datasetRecords.datasetId, datasets.id))
    .where(inArray(datasets.slug, ALL_SLUGS))
    .groupBy(datasets.slug);

  console.log("\nRecords in database:");
  for (const slug of [CUSTOMERS_SLUG, PRODUCTS_SLUG, ORDERS_SLUG]) {
    const row = counts.find((c) => c.slug === slug);
    console.log(`  ${slug.padEnd(10)} ${(row?.records ?? 0).toLocaleString()}`);
  }
  console.log(`  relationships ${relationRows.length.toLocaleString()}`);

  const seconds = ((Date.now() - startedAt) / 1000).toFixed(1);
  console.log(`\nDone in ${seconds}s`);
}

main()
  .catch((err) => {
    console.error("\nSeed failed:", err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await pool.end();
  });
