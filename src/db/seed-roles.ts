import { db, pool } from "./index";
import { roles } from "./schema";

// The 3 platform roles from the project plan.
const ROLE_ROWS = [
  {
    key: "admin",
    label: "Administrator",
    description: "Manage users, datasets, permissions and platform settings.",
  },
  {
    key: "analyst",
    label: "Data Analyst",
    description: "Explore datasets, advanced search, save views, export data.",
  },
  {
    key: "viewer",
    label: "Viewer",
    description: "Browse authorized datasets, search, view records and shared views.",
  },
];

async function main(): Promise<void> {
  await db.insert(roles).values(ROLE_ROWS).onConflictDoNothing();
  console.log("Roles seeded: admin, analyst, viewer");
  await pool.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
