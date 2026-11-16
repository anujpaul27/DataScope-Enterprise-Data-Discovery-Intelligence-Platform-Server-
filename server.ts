import app from "./src/app";
import ConnectDB from "./src/config/connect.db";
import config from "./src/config/config";
import { enableStatementTimeout } from "./src/db";

const start = async () => {
  // 0 turns the limit off. Default: 15 seconds per query.
  const timeoutMs = Number(process.env.DB_STATEMENT_TIMEOUT_MS ?? 15_000);
  if (timeoutMs > 0) enableStatementTimeout(timeoutMs);
  await ConnectDB();
  app.listen(config.PORT, () => {
    console.log(`Server running on ${config.PORT}`);
  });
};

start();
