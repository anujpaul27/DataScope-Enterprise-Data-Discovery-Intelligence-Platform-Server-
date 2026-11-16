import { eq } from "drizzle-orm";
import { db, pool } from "./index";
import { users } from "./schema";
import { ROLES, isRole } from "../lib/roles";

// Usage (from the backend folder):
//   npm run db:make-admin -- you@example.com            -> role = admin
//   npm run db:make-admin -- analyst@example.com analyst
async function main() {
  const email = process.argv[2]?.trim().toLowerCase();
  const role = process.argv[3] ?? "admin";

  if (!email) {
    console.error("Usage: npm run db:make-admin -- <email> [admin|analyst|viewer]");
    process.exitCode = 1;
    return;
  }
  if (!isRole(role)) {
    console.error(`Unknown role "${role}". Use one of: ${ROLES.join(", ")}`);
    process.exitCode = 1;
    return;
  }

  const [updated] = await db
    .update(users)
    .set({ role })
    .where(eq(users.email, email))
    .returning({ email: users.email, role: users.role });

  if (!updated) {
    console.error(`No user with email ${email}. Register in the browser first.`);
    process.exitCode = 1;
    return;
  }
  console.log(`OK: ${updated.email} is now "${updated.role}"`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => pool.end());
