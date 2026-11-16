import { Router } from "express";
import { z } from "zod";
import { and, asc, count, desc, eq, ilike, inArray, ne, notInArray, or, sql, type SQL } from "drizzle-orm";
import { db } from "../db";
import {
  accessPermissions,
  datasetFields,
  datasets,
  savedViewShares,
  savedViews,
  users,
} from "../db/schema";
import { requireAuth, requireRole, type AuthUser } from "../middleware/auth";
import { requireDatasetAccess, visibleDatasetsSql } from "../lib/access";
import { badRequest, conflict, forbidden, notFound } from "../lib/http-error";
import { OPERATORS, buildRecordsQuery, type FieldMeta } from "../lib/records-query";
import { likePattern } from "../lib/sql";

// Mounted at /api/saved-views  (see app.ts)
//
// Who may do what (PDF: "Saved Views"):
//   admin    -> sees and manages every view
//   analyst  -> creates views, edits/deletes/shares their own, opens views shared with them
//   viewer   -> only opens views that were SHARED with them (read-only)
// On top of that, every view is hidden when the user has no access to its dataset.
const router = Router();
router.use(requireAuth);

const idParam = z.object({ id: z.uuid() });
const canWrite = requireRole("admin", "analyst");

// ---------------------------------------------------------------------------
// Shape of a saved search configuration
// ---------------------------------------------------------------------------
const conditionSchema = z.strictObject({
  field: z.string().min(1).max(40),
  op: z.enum(OPERATORS),
  value: z.string().max(200),
  valueTo: z.string().max(200).optional(),
});
const sortSchema = z.strictObject({
  field: z.string().min(1).max(40),
  direction: z.enum(["asc", "desc"]),
});

const nameSchema = z.string().trim().min(1, "Name is required").max(100);
const configShape = {
  globalSearch: z.string().trim().max(100).nullish(),
  conditions: z.array(conditionSchema).max(10),
  sort: z.array(sortSchema).max(3),
  visibleColumns: z.array(z.string().min(1).max(40)).max(60),
};

const createBody = z.strictObject({
  datasetId: z.uuid(),
  name: nameSchema,
  globalSearch: configShape.globalSearch,
  conditions: configShape.conditions.default([]),
  sort: configShape.sort.default([]),
  visibleColumns: configShape.visibleColumns.default([]),
});

const updateBody = z
  .strictObject({
    name: nameSchema.optional(),
    globalSearch: configShape.globalSearch,
    conditions: configShape.conditions.optional(),
    sort: configShape.sort.optional(),
    visibleColumns: configShape.visibleColumns.optional(),
  })
  .refine((b) => Object.keys(b).length > 0, "Send at least one field to change");

interface ViewConfig {
  globalSearch: string | null;
  conditions: z.infer<typeof conditionSchema>[];
  sort: z.infer<typeof sortSchema>[];
  visibleColumns: string[];
}

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

/**
 * A saved view must be something the Records API would accept today. Instead of copying
 * the rules (allowed operators per field type, value parsing, whitelisted field keys),
 * the config is turned into the same query string the Explorer sends and run through the
 * SAME validator (buildRecordsQuery). A bad field / operator / value throws 400.
 */
async function validateConfig(datasetId: string, cfg: ViewConfig): Promise<ViewConfig> {
  const fields = await loadFields(datasetId);
  const columns = [...new Set(cfg.visibleColumns)];
  buildRecordsQuery(
    {
      q: cfg.globalSearch || undefined,
      sort: cfg.sort.map((s) => `${s.field}:${s.direction}`).join(",") || undefined,
      filters: cfg.conditions.length ? JSON.stringify(cfg.conditions) : undefined,
      columns: columns.length ? columns.join(",") : undefined,
    },
    fields,
  );
  return { ...cfg, globalSearch: cfg.globalSearch || null, visibleColumns: columns };
}

// ---------------------------------------------------------------------------
// Reading helpers
// ---------------------------------------------------------------------------
const SHARE_COUNT = sql<number>`(select count(*)::int from saved_view_shares s where s.view_id = saved_views.id)`;

const viewColumns = {
  id: savedViews.id,
  name: savedViews.name,
  datasetId: savedViews.datasetId,
  datasetName: datasets.name,
  globalSearch: savedViews.globalSearch,
  conditions: savedViews.conditions,
  sort: savedViews.sort,
  visibleColumns: savedViews.visibleColumns,
  isShared: savedViews.isShared,
  sharedWithCount: SHARE_COUNT,
  ownerId: savedViews.userId,
  ownerName: users.name,
  createdAt: savedViews.createdAt,
  updatedAt: savedViews.updatedAt,
};

type ViewRow = {
  id: string;
  name: string;
  datasetId: string;
  datasetName: string;
  globalSearch: string | null;
  conditions: unknown[];
  sort: unknown[];
  visibleColumns: string[];
  isShared: boolean;
  sharedWithCount: number;
  ownerId: string;
  ownerName: string;
  createdAt: Date;
  updatedAt: Date;
};

function toView(row: ViewRow, user: AuthUser) {
  const isOwner = row.ownerId === user.id;
  return {
    id: row.id,
    name: row.name,
    datasetId: row.datasetId,
    datasetName: row.datasetName,
    globalSearch: row.globalSearch,
    conditions: row.conditions,
    sort: row.sort,
    visibleColumns: row.visibleColumns,
    isShared: row.isShared,
    sharedWithCount: row.sharedWithCount,
    owner: { id: row.ownerId, name: row.ownerName },
    isOwner,
    // viewers can never change anything, even on their own rows
    canManage: user.role !== "viewer" && (isOwner || user.role === "admin"),
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

const sharedWithMe = (user: AuthUser) =>
  sql`exists (select 1 from saved_view_shares s where s.view_id = saved_views.id and s.user_id = ${user.id})`;

/** Views the user may see: own + shared with them (admins: all). */
function visibleViewsSql(user: AuthUser): SQL | undefined {
  if (user.role === "admin") return undefined;
  return or(eq(savedViews.userId, user.id), sharedWithMe(user));
}

async function loadVisibleView(user: AuthUser, id: string): Promise<ViewRow> {
  const [row] = await db
    .select(viewColumns)
    .from(savedViews)
    .innerJoin(datasets, eq(datasets.id, savedViews.datasetId))
    .innerJoin(users, eq(users.id, savedViews.userId))
    .where(and(eq(savedViews.id, id), visibleDatasetsSql(user), visibleViewsSql(user)))
    .limit(1);
  // 404 for "does not exist" AND "not yours": no hint that the id exists
  if (!row) throw notFound("Saved view not found");
  return row;
}

/** Owner or admin only (callers have already passed requireRole(admin, analyst)). */
async function loadManageableView(user: AuthUser, id: string): Promise<ViewRow> {
  const row = await loadVisibleView(user, id);
  if (row.ownerId !== user.id && user.role !== "admin") {
    throw forbidden("Only the owner can change this view");
  }
  return row;
}

async function assertNameFree(ownerId: string, datasetId: string, name: string, exceptId?: string) {
  const [dup] = await db
    .select({ id: savedViews.id })
    .from(savedViews)
    .where(
      and(
        eq(savedViews.userId, ownerId),
        eq(savedViews.datasetId, datasetId),
        sql`lower(${savedViews.name}) = lower(${name})`,
        exceptId ? ne(savedViews.id, exceptId) : undefined,
      ),
    )
    .limit(1);
  if (dup) throw conflict(`You already have a view named "${name}" on this dataset`);
}

// ---------------------------------------------------------------------------
// GET /api/saved-views?scope=all|mine|shared&datasetId=&q=&page=1&pageSize=12
// ---------------------------------------------------------------------------
const listQuery = z.object({
  scope: z.enum(["all", "mine", "shared"]).default("all"),
  datasetId: z.uuid().optional(),
  q: z.string().trim().max(100).optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(50).default(12),
});

router.get("/", async (req, res) => {
  const user = req.user!;
  const { scope, datasetId, q, page, pageSize } = listQuery.parse(req.query);

  const filters: (SQL | undefined)[] = [visibleDatasetsSql(user)];
  if (scope === "mine") filters.push(eq(savedViews.userId, user.id));
  else if (scope === "shared") filters.push(sharedWithMe(user));
  else filters.push(visibleViewsSql(user));
  if (datasetId) filters.push(eq(savedViews.datasetId, datasetId));
  if (q) filters.push(ilike(savedViews.name, likePattern(q)));
  const where = and(...filters);

  const [rows, [total]] = await Promise.all([
    db
      .select(viewColumns)
      .from(savedViews)
      .innerJoin(datasets, eq(datasets.id, savedViews.datasetId))
      .innerJoin(users, eq(users.id, savedViews.userId))
      .where(where)
      .orderBy(desc(savedViews.updatedAt), asc(savedViews.id))
      .limit(pageSize)
      .offset((page - 1) * pageSize),
    db
      .select({ value: count() })
      .from(savedViews)
      .innerJoin(datasets, eq(datasets.id, savedViews.datasetId))
      .where(where),
  ]);

  res.json({
    data: rows.map((r) => toView(r, user)),
    page,
    pageSize,
    total: total?.value ?? 0,
  });
});

// ---------------------------------------------------------------------------
// GET /api/saved-views/share-targets?datasetId=&q=
// People a view on this dataset can be shared with: active, non-admin users who
// already have access to the dataset (sharing never grants access to data).
// NOTE: declared BEFORE "/:id". /api/users is admin-only, so analysts need this.
// ---------------------------------------------------------------------------
const targetsQuery = z.object({
  datasetId: z.uuid(),
  q: z.string().trim().max(100).optional(),
});

async function shareTargets(datasetId: string, excludeUserId: string, q?: string, ids?: string[]) {
  const like = q ? likePattern(q) : null;
  return db
    .select({ id: users.id, name: users.name, email: users.email, role: users.role })
    .from(users)
    .innerJoin(
      accessPermissions,
      and(eq(accessPermissions.userId, users.id), eq(accessPermissions.datasetId, datasetId)),
    )
    .where(
      and(
        eq(users.isActive, true),
        ne(users.role, "admin"),
        ne(users.id, excludeUserId),
        like ? or(ilike(users.name, like), ilike(users.email, like)) : undefined,
        ids ? inArray(users.id, ids) : undefined,
      ),
    )
    .orderBy(asc(users.name), asc(users.id))
    .limit(ids ? 200 : 20);
}

router.get("/share-targets", canWrite, async (req, res) => {
  const user = req.user!;
  const { datasetId, q } = targetsQuery.parse(req.query);
  await requireDatasetAccess(user, datasetId, "read");
  res.json({ data: await shareTargets(datasetId, user.id, q) });
});

// ---------------------------------------------------------------------------
// POST /api/saved-views
// ---------------------------------------------------------------------------
router.post("/", canWrite, async (req, res) => {
  const user = req.user!;
  const body = createBody.parse(req.body);
  await requireDatasetAccess(user, body.datasetId, "read");

  const config = await validateConfig(body.datasetId, {
    globalSearch: body.globalSearch ?? null,
    conditions: body.conditions,
    sort: body.sort,
    visibleColumns: body.visibleColumns,
  });
  await assertNameFree(user.id, body.datasetId, body.name);

  const [created] = await db
    .insert(savedViews)
    .values({ userId: user.id, datasetId: body.datasetId, name: body.name, ...config })
    .returning({ id: savedViews.id });

  const view = await loadVisibleView(user, created!.id);
  res.status(201).json({ view: toView(view, user) });
});

// ---------------------------------------------------------------------------
// GET /api/saved-views/:id
// ---------------------------------------------------------------------------
router.get("/:id", async (req, res) => {
  const user = req.user!;
  const { id } = idParam.parse(req.params);
  res.json({ view: toView(await loadVisibleView(user, id), user) });
});

// ---------------------------------------------------------------------------
// PATCH /api/saved-views/:id     (rename and/or replace the configuration)
// The dataset of a view can never change: its fields would not match.
// ---------------------------------------------------------------------------
router.patch("/:id", canWrite, async (req, res) => {
  const user = req.user!;
  const { id } = idParam.parse(req.params);
  const body = updateBody.parse(req.body);
  const current = await loadManageableView(user, id);
  await requireDatasetAccess(user, current.datasetId, "read");

  const merged = await validateConfig(current.datasetId, {
    globalSearch: body.globalSearch !== undefined ? (body.globalSearch ?? null) : current.globalSearch,
    conditions: body.conditions ?? (current.conditions as ViewConfig["conditions"]),
    sort: body.sort ?? (current.sort as ViewConfig["sort"]),
    visibleColumns: body.visibleColumns ?? current.visibleColumns,
  });
  const name = body.name ?? current.name;
  if (name.toLowerCase() !== current.name.toLowerCase()) {
    await assertNameFree(current.ownerId, current.datasetId, name, id);
  }

  await db
    .update(savedViews)
    .set({ name, ...merged })
    .where(eq(savedViews.id, id));

  res.json({ view: toView(await loadVisibleView(user, id), user) });
});

// ---------------------------------------------------------------------------
// DELETE /api/saved-views/:id     (its share rows disappear with it: ON DELETE CASCADE)
// ---------------------------------------------------------------------------
router.delete("/:id", canWrite, async (req, res) => {
  const user = req.user!;
  const { id } = idParam.parse(req.params);
  await loadManageableView(user, id);
  await db.delete(savedViews).where(eq(savedViews.id, id));
  res.status(204).end();
});

// ---------------------------------------------------------------------------
// GET /api/saved-views/:id/shares   -> who it is shared with
// PUT /api/saved-views/:id/shares   body { userIds: [...] }  -> replace the whole list
// ---------------------------------------------------------------------------
router.get("/:id/shares", canWrite, async (req, res) => {
  const user = req.user!;
  const { id } = idParam.parse(req.params);
  await loadManageableView(user, id);

  const rows = await db
    .select({ id: users.id, name: users.name, email: users.email, role: users.role })
    .from(savedViewShares)
    .innerJoin(users, eq(users.id, savedViewShares.userId))
    .where(eq(savedViewShares.viewId, id))
    .orderBy(asc(users.name), asc(users.id));
  res.json({ data: rows });
});

const sharesBody = z.strictObject({ userIds: z.array(z.string().min(1).max(100)).max(100) });

router.put("/:id/shares", canWrite, async (req, res) => {
  const user = req.user!;
  const { id } = idParam.parse(req.params);
  const { userIds: rawIds } = sharesBody.parse(req.body);
  const view = await loadManageableView(user, id);
  const userIds = [...new Set(rawIds)];

  // every recipient must already be allowed to open the dataset
  if (userIds.length > 0) {
    const allowed = new Set(
      (await shareTargets(view.datasetId, view.ownerId, undefined, userIds)).map((u) => u.id),
    );
    const rejected = userIds.filter((u) => !allowed.has(u));
    if (rejected.length > 0) {
      throw badRequest(
        "Some people cannot receive this view: they are inactive, have no access to the dataset, or are administrators.",
        { userIds: rejected },
      );
    }
  }

  await db.transaction(async (tx) => {
    if (userIds.length === 0) {
      await tx.delete(savedViewShares).where(eq(savedViewShares.viewId, id));
    } else {
      await tx
        .delete(savedViewShares)
        .where(and(eq(savedViewShares.viewId, id), notInArray(savedViewShares.userId, userIds)));
      await tx
        .insert(savedViewShares)
        .values(userIds.map((userId) => ({ viewId: id, userId })))
        .onConflictDoNothing();
    }
    await tx.update(savedViews).set({ isShared: userIds.length > 0 }).where(eq(savedViews.id, id));
  });

  res.json({ view: toView(await loadVisibleView(user, id), user) });
});

export default router;
