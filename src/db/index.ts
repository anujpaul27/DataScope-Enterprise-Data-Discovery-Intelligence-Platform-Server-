import { Pool } from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import config from "../config/config";
import * as schema from "./schema";

// One shared connection pool for the whole server.
export const pool = new Pool({
  connectionString: config.DATABASE_URL,
  max: 10,
});

// `db` is what every service/controller uses to run queries.
export const db = drizzle({ client: pool, schema });

/**
 * API SERVER ONLY (called from server.ts). Any single query that runs longer than `ms`
 * is cancelled by PostgreSQL (error 57014), so one huge search can never block the
 * connection pool. Scripts such as the seeder do NOT call this: they run long statements.
 */
export function enableStatementTimeout(ms: number): void {
  pool.on("connect", (client) => {
    client.query(`set statement_timeout = ${Math.floor(ms)}`).catch(() => undefined);
  });
}
