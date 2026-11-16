import type { NextFunction, Request, Response } from "express";
import { ZodError } from "zod";
import { HttpError } from "../lib/http-error";

// Every error leaves the API in the same shape:
//   { "error": { "code": "...", "message": "...", "details": ... } }
export function notFoundHandler(_req: Request, res: Response): void {
  res.status(404).json({ error: { code: "NOT_FOUND", message: "Route not found" } });
}

// PostgreSQL error 57014 = "query_canceled" (our statement_timeout fired).
function isStatementTimeout(err: unknown): boolean {
  const e = err as { code?: string; cause?: { code?: string } } | null;
  return e?.code === "57014" || e?.cause?.code === "57014";
}

export function errorHandler(
  err: unknown,
  _req: Request,
  res: Response,
  _next: NextFunction,
): void {
  if (err instanceof HttpError) {
    res.status(err.status).json({
      error: { code: err.code, message: err.message, details: err.details },
    });
    return;
  }
  if (err instanceof ZodError) {
    res.status(400).json({
      error: {
        code: "VALIDATION_ERROR",
        message: "Invalid request",
        details: err.issues.map((i) => ({ path: i.path.join("."), message: i.message })),
      },
    });
    return;
  }
  if (isStatementTimeout(err)) {
    res.status(503).json({
      error: {
        code: "QUERY_TIMEOUT",
        message: "The search took too long. Add a filter or use a more specific search text.",
      },
    });
    return;
  }
  console.error("Unhandled error:", err);
  res
    .status(500)
    .json({ error: { code: "INTERNAL", message: "Something went wrong" } });
}
