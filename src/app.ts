import express, { Application, Request, Response } from "express";
import cors from "cors";
import cookieParser from "cookie-parser";
import config from "./config/config";
import { pool } from "./db";

const app: Application = express();

// middleware
app.use(express.json());
app.use(cors({ origin: config.CLIENT_URL, credentials: true }));
app.use(cookieParser());

// routes (feature routers will be mounted here in the next phases)

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

export default app;
