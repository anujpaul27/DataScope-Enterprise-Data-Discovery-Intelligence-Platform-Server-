import { Router } from "express";
import { requireAuth, requireRole } from "../middleware/auth";
import { recordsCache } from "../lib/query-cache";

const router = Router();
router.use(requireAuth, requireRole("admin"));

// GET /api/admin/cache-stats  -> numbers for the performance report / monitoring dashboard
router.get("/cache-stats", (_req, res) => {
  res.json(recordsCache.stats());
});

export default router;
