import { Router } from "express";
import { z } from "zod";
import { and, asc, count, eq, ilike, or, sql, type SQL } from "drizzle-orm";
import { db } from "../db";
import {
  accessPermissions,
  datasetFields,
  datasets,
  users,
} from "../db/schema";
import { requireAuth, requireRole } from "../middleware/auth";
import {
  levelSql,
  requireDatasetAccess,
  visibleDatasetsSql,
} from "../lib/access";
import { badRequest, conflict, notFound } from "../lib/http-error";
import { isUniqueViolation, likePattern, slugify } from "../lib/sql";

const router = Router();
router.use(requireAuth);

const FIELD_TYPES = ["text", "number", "date", "boolean", "select"] as const;
const LEVELS = ["read", "write", "manage"] as const;
const idParam = z.object({ id: z.uuid() });

// What the library card needs. `datasets.id` is written as plain text inside the
// sub-selects because the outer table is always called "datasets".
const FIELD_COUNT = sql<number>`(select count(*)::int from dataset_fields f where f.dataset_id = datasets.id)`;

// ---------------------------------------------------------------------------
// GET /api/datasets?page=1&pageSize=12&q=cust&category=Inventory
// Only datasets the caller may open. Filtering + paging run in PostgreSQL.
// ---------------------------------------------------------------------------
const listQuery = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(50).default(12),
  q: z.string().trim().max(100).optional(),
  category: z.string().trim().max(60).optional(),
});

router.get("/", async (req, res) => {
  const user = req.user!;
  const { page, pageSize, q, category } = listQuery.parse(req.query);

  const filters: SQL[] = [];
  const visible = visibleDatasetsSql(user);
  if (visible) filters.push(visible);
  if (category) filters.push(eq(datasets.category, category));
  if (q) {
    const like = likePattern(q);
    const match = or(ilike(datasets.name, like), ilike(datasets.description, like));
    if (match) filters.push(match);
  }
  const where = filters.length ? and(...filters) : undefined;

  const [rows, [total]] = await Promise.all([
    db
      .select({
        id: datasets.id,
        name: datasets.name,
        slug: datasets.slug,
        description: datasets.description,
        category: datasets.category,
        dataSource: datasets.dataSource,
        totalRecords: datasets.totalRecords,
        createdAt: datasets.createdAt,
        updatedAt: datasets.updatedAt,
        fieldCount: FIELD_COUNT,
        level: levelSql(user),
      })
      .from(datasets)
      .where(where)
      .orderBy(asc(datasets.name), asc(datasets.id))
      .limit(pageSize)
      .offset((page - 1) * pageSize),
    db.select({ value: count() }).from(datasets).where(where),
  ]);

  res.json({
    data: rows.map((r) => ({ ...r, level: r.level ?? "manage" })),
    page,
    pageSize,
    total: total?.value ?? 0,
  });
});

// ---------------------------------------------------------------------------
// GET /api/datasets/summary   (numbers for the cards at the top of the library)
// NOTE: declared BEFORE "/:id", otherwise Express would read "summary" as an id.
// ---------------------------------------------------------------------------
router.get("/summary", async (req, res) => {
  const visible = visibleDatasetsSql(req.user!);
  const [row] = await db
    .select({
      datasets: count(),
      totalRecords: sql<number>`coalesce(sum(${datasets.totalRecords}), 0)::double precision`,
      categories: sql<number>`count(distinct ${datasets.category})::int`,
    })
    .from(datasets)
    .where(visible);

  res.json({
    datasets: row?.datasets ?? 0,
    totalRecords: Number(row?.totalRecords ?? 0),
    categories: row?.categories ?? 0,
  });
});

// GET /api/datasets/categories  -> for the category filter dropdown
router.get("/categories", async (req, res) => {
  const visible = visibleDatasetsSql(req.user!);
  const rows = await db
    .select({ category: datasets.category, count: count() })
    .from(datasets)
    .where(visible)
    .groupBy(datasets.category)
    .orderBy(asc(datasets.category));
  res.json({ data: rows });
});

// ---------------------------------------------------------------------------
// GET /api/datasets/:id   (dataset + its fields)
// ---------------------------------------------------------------------------
router.get("/:id", async (req, res) => {
  const { id } = idParam.parse(req.params);
  const user = req.user!;
  const level = await requireDatasetAccess(user, id, "read");

  const [dataset] = await db
    .select()
    .from(datasets)
    .where(eq(datasets.id, id))
    .limit(1);
  if (!dataset) throw notFound("Dataset not found");

  const fields = await db
    .select()
    .from(datasetFields)
    .where(eq(datasetFields.datasetId, id))
    .orderBy(asc(datasetFields.position), asc(datasetFields.label));

  res.json({ dataset: { ...dataset, level, fields } });
});

// ---------------------------------------------------------------------------
// Everything below: administrators only
// ---------------------------------------------------------------------------
const fieldInput = z.object({
  key: z
    .string()
    .regex(/^[a-zA-Z][a-zA-Z0-9_]{0,39}$/, "Use letters, digits and _ (start with a letter)"),
  label: z.string().trim().min(1).max(80),
  type: z.enum(FIELD_TYPES),
  options: z.array(z.string().trim().min(1).max(80)).max(200).optional(),
  isSearchable: z.boolean().optional(),
  isFilterable: z.boolean().optional(),
  isSortable: z.boolean().optional(),
  isVisibleByDefault: z.boolean().optional(),
});

const createBody = z
  .object({
    name: z.string().trim().min(2).max(100),
    description: z.string().trim().max(500).optional(),
    category: z.string().trim().min(2).max(60),
    dataSource: z.string().trim().min(2).max(100),
    fields: z.array(fieldInput).min(1).max(60),
  })
  .superRefine((body, ctx) => {
    const seen = new Set<string>();
    body.fields.forEach((f, i) => {
      if (seen.has(f.key)) {
        ctx.addIssue({ code: "custom", path: ["fields", i, "key"], message: `Duplicate field key "${f.key}"` });
      }
      seen.add(f.key);
      if (f.type === "select" && (!f.options || f.options.length === 0)) {
        ctx.addIssue({ code: "custom", path: ["fields", i, "options"], message: "A select field needs at least one option" });
      }
    });
  });

// POST /api/datasets
router.post("/", requireRole("admin"), async (req, res) => {
  const body = createBody.parse(req.body);
  const slug = slugify(body.name);
  if (!slug) throw badRequest("Name must contain letters or digits");

  const [taken] = await db
    .select({ id: datasets.id })
    .from(datasets)
    .where(eq(datasets.slug, slug))
    .limit(1);
  if (taken) throw conflict("A dataset with a very similar name already exists");

  try {
    const created = await db.transaction(async (tx) => {
      const [ds] = await tx
        .insert(datasets)
        .values({
          name: body.name,
          slug,
          description: body.description || null,
          category: body.category,
          dataSource: body.dataSource,
          createdBy: req.user!.id,
        })
        .returning();
      if (!ds) throw new Error("Insert returned no row");

      await tx.insert(datasetFields).values(
        body.fields.map((f, i) => ({
          datasetId: ds.id,
          key: f.key,
          label: f.label,
          type: f.type,
          options: f.type === "select" ? (f.options ?? []) : null,
          isSearchable: f.isSearchable ?? f.type === "text",
          isFilterable: f.isFilterable ?? true,
          isSortable: f.isSortable ?? true,
          isVisibleByDefault: f.isVisibleByDefault ?? true,
          position: i,
        })),
      );
      return ds;
    });
    res.status(201).json({ dataset: created });
  } catch (err) {
    // Two admins creating the same name at the same moment: the UNIQUE index decides.
    if (isUniqueViolation(err)) throw conflict("A dataset with a very similar name already exists");
    throw err;
  }
});

// PATCH /api/datasets/:id   (metadata only; fields stay as they are)
const patchBody = z
  .object({
    name: z.string().trim().min(2).max(100).optional(),
    description: z.string().trim().max(500).nullable().optional(),
    category: z.string().trim().min(2).max(60).optional(),
    dataSource: z.string().trim().min(2).max(100).optional(),
  })
  .refine((b) => Object.keys(b).length > 0, { message: "Nothing to update" });

router.patch("/:id", requireRole("admin"), async (req, res) => {
  const { id } = idParam.parse(req.params);
  const body = patchBody.parse(req.body);

  const [updated] = await db
    .update(datasets)
    .set({
      ...(body.name !== undefined && { name: body.name }),
      ...(body.description !== undefined && { description: body.description || null }),
      ...(body.category !== undefined && { category: body.category }),
      ...(body.dataSource !== undefined && { dataSource: body.dataSource }),
    })
    .where(eq(datasets.id, id))
    .returning();
  if (!updated) throw notFound("Dataset not found");
  res.json({ dataset: updated });
});

// DELETE /api/datasets/:id   (records, fields and permissions go with it: ON DELETE CASCADE)
router.delete("/:id", requireRole("admin"), async (req, res) => {
  const { id } = idParam.parse(req.params);
  const deleted = await db
    .delete(datasets)
    .where(eq(datasets.id, id))
    .returning({ id: datasets.id });
  if (deleted.length === 0) throw notFound("Dataset not found");
  res.status(204).end();
});

// ---------------------------------------------------------------------------
// Dataset permissions (admin only)
// ---------------------------------------------------------------------------

// GET /api/datasets/:id/permissions
router.get("/:id/permissions", requireRole("admin"), async (req, res) => {
  const { id } = idParam.parse(req.params);
  const rows = await db
    .select({
      userId: users.id,
      name: users.name,
      email: users.email,
      role: users.role,
      level: accessPermissions.level,
      grantedAt: accessPermissions.createdAt,
    })
    .from(accessPermissions)
    .innerJoin(users, eq(users.id, accessPermissions.userId))
    .where(eq(accessPermissions.datasetId, id))
    .orderBy(asc(users.name), asc(users.id));
  res.json({ data: rows });
});

// PUT /api/datasets/:id/permissions   { "userId": "...", "level": "read" }   (grant or change)
const grantBody = z.object({
  userId: z.string().min(1),
  level: z.enum(LEVELS),
});

router.put("/:id/permissions", requireRole("admin"), async (req, res) => {
  const { id } = idParam.parse(req.params);
  const { userId, level } = grantBody.parse(req.body);

  const [dataset] = await db
    .select({ id: datasets.id })
    .from(datasets)
    .where(eq(datasets.id, id))
    .limit(1);
  if (!dataset) throw notFound("Dataset not found");

  const [target] = await db
    .select({ id: users.id, role: users.role })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);
  if (!target) throw notFound("User not found");
  if (target.role === "admin") {
    throw badRequest("Administrators already have access to every dataset");
  }

  const [permission] = await db
    .insert(accessPermissions)
    .values({ datasetId: id, userId, level, grantedBy: req.user!.id })
    .onConflictDoUpdate({
      target: [accessPermissions.datasetId, accessPermissions.userId],
      set: { level, grantedBy: req.user!.id },
    })
    .returning();
  res.json({ permission });
});

// DELETE /api/datasets/:id/permissions/:userId
router.delete("/:id/permissions/:userId", requireRole("admin"), async (req, res) => {
  const { id, userId } = z
    .object({ id: z.uuid(), userId: z.string().min(1) })
    .parse(req.params);
  const removed = await db
    .delete(accessPermissions)
    .where(and(eq(accessPermissions.datasetId, id), eq(accessPermissions.userId, userId)))
    .returning({ id: accessPermissions.id });
  if (removed.length === 0) throw notFound("Permission not found");
  res.status(204).end();
});

export default router;
