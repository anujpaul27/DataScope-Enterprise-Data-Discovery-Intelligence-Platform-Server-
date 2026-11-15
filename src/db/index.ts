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
