import { Router } from "express";
import { z } from "zod";
import { and, count, desc, eq, type SQL } from "drizzle-orm";
import { db } from "../db";
import { datasets, searchHistory } from "../db/schema";
import { requireAuth } from "../middleware/auth";
import { visibleDatasetsSql } from "../lib/access";
import { notFound } from "../lib/http-error";

const router = Router();
router.use(requireAuth);

const listQuery = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(50).default(20),
  datasetId: z.uuid().optional(),
});

// GET /api/search-history?page=1&pageSize=20&datasetId=...
// ONLY the caller's own searches, and only for datasets they can still open.
router.get("/", async (req, res) => {
  const user = req.user!;
  const { page, pageSize, datasetId } = listQuery.parse(req.query);

  const filters: SQL[] = [eq(searchHistory.userId, user.id)];
  if (datasetId) filters.push(eq(searchHistory.datasetId, datasetId));
  const visible = visibleDatasetsSql(user);
  if (visible) filters.push(visible);
  const where = and(...filters);

  const [rows, [total]] = await Promise.all([
    db
      .select({
        id: searchHistory.id,
        datasetId: searchHistory.datasetId,
        datasetName: datasets.name,
        globalSearch: searchHistory.globalSearch,
        conditions: searchHistory.conditions,
        sort: searchHistory.sort,
        resultCount: searchHistory.resultCount,
        durationMs: searchHistory.durationMs,
        createdAt: searchHistory.createdAt,
      })
      .from(searchHistory)
      .innerJoin(datasets, eq(datasets.id, searchHistory.datasetId))
      .where(where)
      .orderBy(desc(searchHistory.createdAt), desc(searchHistory.id))
      .limit(pageSize)
      .offset((page - 1) * pageSize),
    db
      .select({ value: count() })
      .from(searchHistory)
      .innerJoin(datasets, eq(datasets.id, searchHistory.datasetId))
      .where(where),
  ]);

  res.json({ data: rows, page, pageSize, total: total?.value ?? 0 });
});

// DELETE /api/search-history        (clear all of MY history)
router.delete("/", async (req, res) => {
  await db.delete(searchHistory).where(eq(searchHistory.userId, req.user!.id));
  res.status(204).end();
});

// DELETE /api/search-history/:id    (one of MY entries)
router.delete("/:id", async (req, res) => {
  const { id } = z.object({ id: z.coerce.number().int().positive() }).parse(req.params);
  const removed = await db
    .delete(searchHistory)
    .where(and(eq(searchHistory.id, id), eq(searchHistory.userId, req.user!.id)))
    .returning({ id: searchHistory.id });
  if (removed.length === 0) throw notFound("History entry not found");
  res.status(204).end();
});

export default router;
