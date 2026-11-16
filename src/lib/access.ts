import { and, eq, sql, type SQL } from "drizzle-orm";
import { db } from "../db";
import { accessPermissions, datasets } from "../db/schema";
import type { AuthUser } from "../middleware/auth";
import { forbidden, notFound } from "./http-error";

// Dataset-level permissions (PDF section 13).
// Admins can open every dataset. Analysts and viewers need a row in
// access_permissions. EVERY route that touches one dataset must go through
// requireDatasetAccess(), and every list must be filtered with visibleDatasetsSql().
// The frontend is never trusted to say what a user may see.

export const LEVEL_RANK = { read: 1, write: 2, manage: 3 } as const;
export type PermissionLevel = keyof typeof LEVEL_RANK;

/** Highest access the user has on the dataset, or null when they have none. */
export async function getEffectiveLevel(
  user: AuthUser,
  datasetId: string,
): Promise<PermissionLevel | null> {
  if (user.role === "admin") {
    const [d] = await db
      .select({ id: datasets.id })
      .from(datasets)
      .where(eq(datasets.id, datasetId))
      .limit(1);
    return d ? "manage" : null;
  }
  const [row] = await db
    .select({ level: accessPermissions.level })
    .from(accessPermissions)
    .where(
      and(
        eq(accessPermissions.datasetId, datasetId),
        eq(accessPermissions.userId, user.id),
      ),
    )
    .limit(1);
  return row?.level ?? null;
}

/**
 * Throws 404 when the user has no access at all (so we do not even reveal that the
 * dataset exists), 403 when they have access but not enough of it.
 */
export async function requireDatasetAccess(
  user: AuthUser,
  datasetId: string,
  min: PermissionLevel = "read",
): Promise<PermissionLevel> {
  const level = await getEffectiveLevel(user, datasetId);
  if (!level) throw notFound("Dataset not found");
  if (LEVEL_RANK[level] < LEVEL_RANK[min]) {
    throw forbidden("You do not have enough access to this dataset");
  }
  return level;
}

/** WHERE-fragment for queries on `datasets`: undefined for admins (no restriction). */
export function visibleDatasetsSql(user: AuthUser): SQL | undefined {
  if (user.role === "admin") return undefined;
  return sql`exists (select 1 from access_permissions ap where ap.dataset_id = datasets.id and ap.user_id = ${user.id})`;
}

/** SELECT-expression: the user's own level on each dataset row (null for admins). */
export function levelSql(user: AuthUser) {
  return sql<PermissionLevel | null>`(select ap.level from access_permissions ap where ap.dataset_id = datasets.id and ap.user_id = ${user.id})`;
}
