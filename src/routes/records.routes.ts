import { Router } from "express";
import { z } from "zod";
import { and, asc, eq, sql } from "drizzle-orm";
import { db } from "../db";
import { datasetFields, datasetRecords } from "../db/schema";
import { requireAuth } from "../middleware/auth";
import { requireDatasetAccess } from "../lib/access";
import { notFound } from "../lib/http-error";
import { COUNT_CAP, buildRecordsQuery, type FieldMeta } from "../lib/records-query";

// Mounted at /api/datasets/:id/records  (see app.ts)
const router = Router({ mergeParams: true });
router.use(requireAuth);

const idParam = z.object({ id: z.uuid() });

async function loadFields(datasetId: string): Promise<FieldMeta[]> {
  return db
    .select({
      key: datasetFields.key,
      type: datasetFields.type,
      isSearchable: datasetFields.isSearchable,
      isFilterable: datasetFields.isFilterable,
      isSortable: datasetFields.isSortable,
    })
    .from(datasetFields)
    .where(eq(datasetFields.datasetId, datasetId))
    .orderBy(asc(datasetFields.position));
}

// ---------------------------------------------------------------------------
// GET /api/datasets/:id/records
//   ?page=1&pageSize=25&q=anna&sort=revenue:desc,name:asc
//   &filters=[{"field":"country","op":"eq","value":"Germany"}]
//   &columns=name,country,revenue
// Filtering, sorting, paging and counting ALL run in PostgreSQL.
// ---------------------------------------------------------------------------
router.get("/", async (req, res) => {
  const started = process.hrtime.bigint();
  const { id } = idParam.parse(req.params);
  await requireDatasetAccess(req.user!, id, "read"); // 404 when there is no permission row

  const fields = await loadFields(id);
  const query = buildRecordsQuery(req.query, fields);

  const where = and(eq(datasetRecords.datasetId, id), ...query.where)!;
  const order = sql.join(query.orderBy, sql`, `);

  // Page rows and total count run at the same time (one round trip each, in parallel).
  const [rows, countResult] = await Promise.all([
    db.execute<{ id: string; data: Record<string, unknown>; created_at: string; updated_at: string }>(sql`
      select dataset_records.id,
             ${query.select} as data,
             dataset_records.created_at,
             dataset_records.updated_at
      from dataset_records
      where ${where}
      order by ${order}
      limit ${query.pageSize} offset ${query.offset}
    `),
    // Capped count: never scans more than COUNT_CAP + 1 matching rows, so the total
    // stays cheap even when a dataset grows to many millions of rows.
    db.execute<{ n: number }>(sql`
      select count(*)::int as n
      from (select 1 from dataset_records where ${where} limit ${COUNT_CAP + 1}) capped
    `),
  ]);

  const counted = countResult.rows[0]?.n ?? 0;
  const totalCapped = counted > COUNT_CAP;
  const total = totalCapped ? COUNT_CAP : counted;

  const ms = Number(process.hrtime.bigint() - started) / 1e6;
  res.setHeader("Server-Timing", `records;dur=${ms.toFixed(1)}`);
  res.json({
    data: rows.rows.map((r) => ({
      id: Number(r.id),
      data: r.data,
      createdAt: r.created_at,
      updatedAt: r.updated_at,
    })),
    page: query.page,
    pageSize: query.pageSize,
    total,
    totalCapped,
    tookMs: Math.round(ms),
  });
});

// ---------------------------------------------------------------------------
// GET /api/datasets/:id/records/:recordId     (one full record)
// The WHERE has BOTH ids: a record of another dataset can never be read by editing
// the URL, even when the user may open the dataset named in the URL.
// ---------------------------------------------------------------------------
router.get("/:recordId", async (req, res) => {
  const { id, recordId } = z
    .object({ id: z.uuid(), recordId: z.coerce.number().int().positive() })
    .parse(req.params);
  await requireDatasetAccess(req.user!, id, "read");

  const [row] = await db
    .select()
    .from(datasetRecords)
    .where(and(eq(datasetRecords.id, recordId), eq(datasetRecords.datasetId, id)))
    .limit(1);
  if (!row) throw notFound("Record not found");

  res.json({
    record: { id: row.id, data: row.data, createdAt: row.createdAt, updatedAt: row.updatedAt },
  });
});

export default router;
