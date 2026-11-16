import express, { Application, Request, Response } from "express";
import cors from "cors";
import cookieParser from "cookie-parser";
import config from "./config/config";
import { pool } from "./db";
import meRoutes from "./routes/me.routes";
import usersRoutes from "./routes/users.routes";
import datasetsRoutes from "./routes/datasets.routes";
import recordsRoutes from "./routes/records.routes";
import searchHistoryRoutes from "./routes/search-history.routes";
import adminRoutes from "./routes/admin.routes";
import { errorHandler, notFoundHandler } from "./middleware/error";
import savedViewsRouter from './routes/saved-views.routes';

const app: Application = express();

// middleware
app.use(express.json({ limit: "50mb" }));
app.use(express.urlencoded({ limit: "50mb", extended: true }));
const allowedOrigins = [
  "http://localhost:3000",
  "https://data-scope-kappa.vercel.app/", // Firebase frontend
];
app.use(
  cors({
    origin: allowedOrigins,
    credentials: true,
  }),
);
app.use(cookieParser());

app.get("/", (_req: Request, res: Response) => {
  res.send("DataScope API is running..");
});

// Health check: also proves the database is reachable
app.get("/health", async (_req: Request, res: Response) => {
  try {
    await pool.query("select 1");
    res.json({ status: "ok", db: "up" });
  } catch {
    res.status(503).json({ status: "error", db: "down" });
  }
});

// feature routers (more are mounted here in later phases)
app.use("/api/me", meRoutes);
app.use("/api/users", usersRoutes);
app.use("/api/datasets/:id/records", recordsRoutes);
app.use("/api/datasets", datasetsRoutes);
app.use("/api/search-history", searchHistoryRoutes);
app.use("/api/admin", adminRoutes);
app.use('/api/saved-views', savedViewsRouter);

// must stay last
app.use(notFoundHandler);
app.use(errorHandler);

export default app;
