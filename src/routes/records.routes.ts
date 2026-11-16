import { Router } from "express";
import { z } from "zod";
import { and, asc, desc, eq, inArray, sql } from "drizzle-orm";
import { db } from "../db";
import { datasetFields, datasetRecords, recordHistory, users } from "../db/schema";
import { requireAuth } from "../middleware/auth";
import { requireDatasetAccess } from "../lib/access";
import { notFound } from "../lib/http-error";
import { COUNT_CAP, buildRecordsQuery, type FieldMeta } from "../lib/records-query";
import { recordsCache } from "../lib/query-cache";
import { recordSearch } from "../lib/search-history";

// Mounted at /api/datasets/:id/records  (see app.ts)
const router = Router({ mergeParams: true });
router.use(requireAuth);

const idParam = z.object({ id: z.uuid() });
const recordParams = z.object({
  id: z.uuid(),
  recordId: z.coerce.number().int().positive(),
});

const RELATED_LIMIT = 50;
const HISTORY_LIMIT = 50;
const PREVIEW_KEYS = 4;

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

/** Ensure the record belongs to this dataset (URL cannot point at another dataset's row). */
async function requireRecordInDataset(datasetId: string, recordId: number) {
  const [row] = await db
    .select({ id: datasetRecords.id })
    .from(datasetRecords)
    .where(and(eq(datasetRecords.id, recordId), eq(datasetRecords.datasetId, datasetId)))
    .limit(1);
  if (!row) throw notFound("Record not found");
  return row;
}

/** Keep only a few default-visible fields so related cards stay small. */
function pickPreview(
  data: Record<string, unknown>,
  preferredKeys: string[],
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const key of preferredKeys) {
    if (key in data) out[key] = data[key];
    if (Object.keys(out).length >= PREVIEW_KEYS) break;
  }
  if (Object.keys(out).length > 0) return out;
  for (const [key, value] of Object.entries(data)) {
    out[key] = value;
    if (Object.keys(out).length >= PREVIEW_KEYS) break;
  }
  return out;
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
  const user = req.user!;
  // 1) permission and 2) validation come BEFORE the cache: the cache can never be used to
  //    read a dataset without access, and invalid queries are never cached.
  await requireDatasetAccess(user, id, "read"); // 404 when there is no permission row

  const fields = await loadFields(id);
  const query = buildRecordsQuery(req.query, fields);

  // 3) cache + request de-duplication (see lib/query-cache.ts)
  const { value, status } = await recordsCache.getOrCompute(`${id}|${query.signature}`, async () => {
    const computeStarted = process.hrtime.bigint();
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
    return {
      data: rows.rows.map((r) => ({
        id: Number(r.id),
        data: r.data,
        createdAt: r.created_at,
        updatedAt: r.updated_at,
      })),
      page: query.page,
      pageSize: query.pageSize,
      total: totalCapped ? COUNT_CAP : counted,
      totalCapped,
      tookMs: Math.round(Number(process.hrtime.bigint() - computeStarted) / 1e6),
    };
  });

  const ms = Number(process.hrtime.bigint() - started) / 1e6;
  res.setHeader("X-Cache", status.toUpperCase()); // HIT | MISS | SHARED
  res.setHeader("Server-Timing", `records;dur=${ms.toFixed(1)}, cache;desc="${status}"`);
  res.json({ ...value, tookMs: Math.round(ms), cached: status !== "miss" });

  // 4) search history (after the response was sent: it can never slow the user down)
  recordSearch({
    userId: user.id,
    datasetId: id,
    page: query.page,
    q: query.search.q,
    filters: query.search.filters,
    sort: query.search.sort,
    resultCount: value.total,
    durationMs: Math.round(ms),
  });
});

// ---------------------------------------------------------------------------
// GET /api/datasets/:id/records/:recordId     (one full record)
// The WHERE has BOTH ids: a record of another dataset can never be read by editing
// the URL, even when the user may open the dataset named in the URL.
// ---------------------------------------------------------------------------
router.get("/:recordId", async (req, res) => {
  const { id, recordId } = recordParams.parse(req.params);
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

// ---------------------------------------------------------------------------
// GET /api/datasets/:id/records/:recordId/related
// Bidirectional links. Related rows in datasets the user cannot open are omitted
// (no leak of unauthorized record payloads).
// ---------------------------------------------------------------------------
router.get("/:recordId/related", async (req, res) => {
  const { id, recordId } = recordParams.parse(req.params);
  await requireDatasetAccess(req.user!, id, "read");
  await requireRecordInDataset(id, recordId);

  const user = req.user!;
  const accessFilter =
    user.role === "admin"
      ? sql`true`
      : sql`exists (
          select 1 from access_permissions ap
          where ap.dataset_id = other.dataset_id and ap.user_id = ${user.id}
        )`;

  const rows = await db.execute<{
    relation_type: string;
    direction: "outgoing" | "incoming";
    related_id: string;
    related_dataset_id: string;
    related_dataset_name: string;
    related_dataset_slug: string;
    data: Record<string, unknown>;
  }>(sql`
    select
      rr.relation_type,
      case when rr.source_record_id = ${recordId} then 'outgoing' else 'incoming' end as direction,
      other.id as related_id,
      other.dataset_id as related_dataset_id,
      d.name as related_dataset_name,
      d.slug as related_dataset_slug,
      other.data
    from record_relationships rr
    inner join dataset_records other
      on other.id = case
        when rr.source_record_id = ${recordId} then rr.target_record_id
        else rr.source_record_id
      end
    inner join datasets d on d.id = other.dataset_id
    where (rr.source_record_id = ${recordId} or rr.target_record_id = ${recordId})
      and ${accessFilter}
    order by rr.relation_type asc, other.id asc
    limit ${RELATED_LIMIT}
  `);

  const datasetIds = [...new Set(rows.rows.map((r) => r.related_dataset_id))];
  const previewKeysByDataset = new Map<string, string[]>();
  if (datasetIds.length > 0) {
    const fields = await db
      .select({
        datasetId: datasetFields.datasetId,
        key: datasetFields.key,
        isVisibleByDefault: datasetFields.isVisibleByDefault,
      })
      .from(datasetFields)
      .where(inArray(datasetFields.datasetId, datasetIds))
      .orderBy(asc(datasetFields.position));

    for (const dsId of datasetIds) {
      const forDs = fields.filter((f) => f.datasetId === dsId);
      const preferred = forDs.filter((f) => f.isVisibleByDefault).map((f) => f.key);
      previewKeysByDataset.set(
        dsId,
        preferred.length > 0 ? preferred : forDs.map((f) => f.key),
      );
    }
  }

  res.json({
    related: rows.rows.map((r) => ({
      relationType: r.relation_type,
      direction: r.direction,
      recordId: Number(r.related_id),
      datasetId: r.related_dataset_id,
      datasetName: r.related_dataset_name,
      datasetSlug: r.related_dataset_slug,
      preview: pickPreview(r.data ?? {}, previewKeysByDataset.get(r.related_dataset_id) ?? []),
    })),
  });
});

// ---------------------------------------------------------------------------
// GET /api/datasets/:id/records/:recordId/history
// Field-level change log for the Record Details panel (newest first).
// ---------------------------------------------------------------------------
router.get("/:recordId/history", async (req, res) => {
  const { id, recordId } = recordParams.parse(req.params);
  await requireDatasetAccess(req.user!, id, "read");
  await requireRecordInDataset(id, recordId);

  const rows = await db
    .select({
      id: recordHistory.id,
      changes: recordHistory.changes,
      createdAt: recordHistory.createdAt,
      changedById: recordHistory.changedBy,
      changedByName: users.name,
    })
    .from(recordHistory)
    .leftJoin(users, eq(recordHistory.changedBy, users.id))
    .where(eq(recordHistory.recordId, recordId))
    .orderBy(desc(recordHistory.createdAt), desc(recordHistory.id))
    .limit(HISTORY_LIMIT);

  const fieldLabels = await db
    .select({ key: datasetFields.key, label: datasetFields.label })
    .from(datasetFields)
    .where(eq(datasetFields.datasetId, id));
  const labelByKey = new Map(fieldLabels.map((f) => [f.key, f.label]));

  res.json({
    history: rows.map((r) => ({
      id: r.id,
      createdAt: r.createdAt,
      changedBy: r.changedByName ?? (r.changedById ? "Unknown user" : "System"),
      changes: Object.entries(r.changes).map(([field, change]) => ({
        field,
        label: labelByKey.get(field) ?? field,
        from: change.from,
        to: change.to,
      })),
    })),
  });
});

export default router;
