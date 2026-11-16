import { eq } from "drizzle-orm";
import { db, pool } from "./index";
import { accessPermissions, datasets, users } from "./schema";

const LEVELS = ["read", "write", "manage"] as const;
type Level = (typeof LEVELS)[number];

// Usage (from the backend folder):
//   npm run db:grant -- analyst@example.com                    -> read on ALL datasets
//   npm run db:grant -- viewer@example.com read customers      -> read on one dataset (slug)
//   npm run db:grant -- analyst@example.com write all
async function main() {
  const email = process.argv[2]?.trim().toLowerCase();
  const level = (process.argv[3] ?? "read") as Level;
  const target = process.argv[4] ?? "all";

  if (!email) {
    console.error("Usage: npm run db:grant -- <email> [read|write|manage] [dataset-slug|all]");
    process.exitCode = 1;
    return;
  }
  if (!LEVELS.includes(level)) {
    console.error(`Unknown level "${level}". Use one of: ${LEVELS.join(", ")}`);
    process.exitCode = 1;
    return;
  }

  const [user] = await db
    .select({ id: users.id, role: users.role })
    .from(users)
    .where(eq(users.email, email))
    .limit(1);
  if (!user) {
    console.error(`No user with email ${email}. Register in the browser first.`);
    process.exitCode = 1;
    return;
  }
  if (user.role === "admin") {
    console.log("Note: administrators already see every dataset; granting anyway is harmless.");
  }

  const all = await db.select({ id: datasets.id, slug: datasets.slug }).from(datasets);
  const chosen = target === "all" ? all : all.filter((d) => d.slug === target);
  if (chosen.length === 0) {
    console.error(`No dataset matches "${target}". Available: ${all.map((d) => d.slug).join(", ")}`);
    process.exitCode = 1;
    return;
  }

  for (const d of chosen) {
    await db
      .insert(accessPermissions)
      .values({ datasetId: d.id, userId: user.id, level })
      .onConflictDoUpdate({
        target: [accessPermissions.datasetId, accessPermissions.userId],
        set: { level },
      });
  }
  console.log(`OK: ${email} now has "${level}" on ${chosen.map((d) => d.slug).join(", ")}`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => pool.end());
