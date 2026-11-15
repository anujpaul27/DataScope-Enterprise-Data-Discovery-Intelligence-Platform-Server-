import { pool } from "../db";

const ConnectDB = async (): Promise<void> => {
  try {
    await pool.query("select 1");
    console.log("Connected to PostgreSQL..");
  } catch (err) {
    console.error("DB connect error:", err);
    process.exit(1);
  }
};

export default ConnectDB;
