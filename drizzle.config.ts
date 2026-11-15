import "dotenv/config";
import { defineConfig } from "drizzle-kit";

if (!process.env.DATABASE_URL) {
  throw new Error("DATABASE_URL is empty! Check your .env file.");
}

export default defineConfig({
  dialect: "postgresql",
  // Where the table definitions live
  schema: "./src/db/schema/index.ts",
  // Where generated SQL migration files are saved (commit this folder to git)
  out: "./drizzle",
  dbCredentials: {
    url: process.env.DATABASE_URL,
  },
});
