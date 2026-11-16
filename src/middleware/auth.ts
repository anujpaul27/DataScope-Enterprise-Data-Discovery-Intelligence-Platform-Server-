import type { NextFunction, Request, Response } from "express";
import { createRemoteJWKSet, jwtVerify } from "jose-cjs";
import { eq } from "drizzle-orm";
import config from "../config/config";
import { db } from "../db";
import { users } from "../db/schema";
import { forbidden, unauthorized } from "../lib/http-error";
import { isRole, type Role } from "../lib/roles";

export interface AuthUser {
  id: string;
  name: string;
  email: string;
  role: Role;
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      user?: AuthUser;
    }
  }
}

// Public keys of better-auth. jose downloads them once, caches them, and
// re-fetches automatically if a token is signed with a key it does not know yet.
const jwks = createRemoteJWKSet(new URL(config.AUTH_JWKS_URL));

/**
 * 1. Reads "Authorization: Bearer <jwt>"
 * 2. Verifies signature, issuer, audience and expiry
 * 3. Loads the user from the database, so the role is ALWAYS the current one
 *    (a demoted or disabled user loses access immediately, not after the token expires)
 */
export async function requireAuth(
  req: Request,
  _res: Response,
  next: NextFunction,
): Promise<void> {
  const header = req.headers.authorization;
  if (!header || !header.startsWith("Bearer ")) {
    throw unauthorized("Missing bearer token");
  }
  const token = header.slice("Bearer ".length).trim();

  let userId: string;
  try {
    const { payload } = await jwtVerify(token, jwks, {
      issuer: config.AUTH_BASE_URL,
      audience: config.AUTH_BASE_URL,
    });
    if (!payload.sub) throw new Error("token has no subject");
    userId = payload.sub;
  } catch {
    throw unauthorized("Invalid or expired token");
  }

  const [row] = await db
    .select({
      id: users.id,
      name: users.name,
      email: users.email,
      role: users.role,
      isActive: users.isActive,
    })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);

  if (!row) throw unauthorized("User no longer exists");
  if (!row.isActive) throw forbidden("This account has been deactivated");
  if (!isRole(row.role)) throw forbidden("Unknown role");

  req.user = { id: row.id, name: row.name, email: row.email, role: row.role };
  next();
}

/** Use AFTER requireAuth: `router.get("/", requireAuth, requireRole("admin"), handler)` */
export function requireRole(...allowed: Role[]) {
  return (req: Request, _res: Response, next: NextFunction): void => {
    if (!req.user) throw unauthorized();
    if (!allowed.includes(req.user.role)) throw forbidden();
    next();
  };
}
