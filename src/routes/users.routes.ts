import { Router } from "express";
import { z } from "zod";
import { and, asc, count, eq, ilike, or, type SQL } from "drizzle-orm";
import { db } from "../db";
import { users } from "../db/schema";
import { requireAuth, requireRole } from "../middleware/auth";
import { badRequest, notFound } from "../lib/http-error";
import { ROLES } from "../lib/roles";

const router = Router();

// Everything in this file is admin-only.
router.use(requireAuth, requireRole("admin"));

const listQuery = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
  q: z.string().trim().max(100).optional(),
  role: z.enum(ROLES).optional(),
});

const userColumns = {
  id: users.id,
  name: users.name,
  email: users.email,
  role: users.role,
  isActive: users.isActive,
  createdAt: users.createdAt,
};

// GET /api/users?page=1&pageSize=20&q=ali&role=analyst
router.get("/", async (req, res) => {
  const { page, pageSize, q, role } = listQuery.parse(req.query);

  const filters: SQL[] = [];
  if (role) filters.push(eq(users.role, role));
  if (q) {
    // escape % and _ so the search text is treated literally
    const like = `%${q.replace(/[%_\\]/g, "\\$&")}%`;
    const match = or(ilike(users.name, like), ilike(users.email, like));
    if (match) filters.push(match);
  }
  const where = filters.length ? and(...filters) : undefined;

  const [rows, [total]] = await Promise.all([
    db
      .select(userColumns)
      .from(users)
      .where(where)
      .orderBy(asc(users.createdAt), asc(users.id))
      .limit(pageSize)
      .offset((page - 1) * pageSize),
    db.select({ value: count() }).from(users).where(where),
  ]);

  res.json({
    data: rows,
    page,
    pageSize,
    total: total?.value ?? 0,
  });
});

const idParam = z.object({ id: z.string().min(1) });

// PATCH /api/users/:id/role   { "role": "analyst" }
router.patch("/:id/role", async (req, res) => {
  const { id } = idParam.parse(req.params);
  const { role } = z.object({ role: z.enum(ROLES) }).parse(req.body);

  // Stops the last admin from locking everybody out by accident.
  if (id === req.user!.id && role !== "admin") {
    throw badRequest("You cannot remove your own admin role");
  }

  const [updated] = await db
    .update(users)
    .set({ role })
    .where(eq(users.id, id))
    .returning(userColumns);
  if (!updated) throw notFound("User not found");
  res.json({ user: updated });
});

// PATCH /api/users/:id/status   { "isActive": false }
router.patch("/:id/status", async (req, res) => {
  const { id } = idParam.parse(req.params);
  const { isActive } = z.object({ isActive: z.boolean() }).parse(req.body);

  if (id === req.user!.id && !isActive) {
    throw badRequest("You cannot deactivate your own account");
  }

  const [updated] = await db
    .update(users)
    .set({ isActive })
    .where(eq(users.id, id))
    .returning(userColumns);
  if (!updated) throw notFound("User not found");
  res.json({ user: updated });
});

export default router;
