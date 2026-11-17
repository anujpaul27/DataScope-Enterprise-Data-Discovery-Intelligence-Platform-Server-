import dotenv from "dotenv";

dotenv.config();

if (!process.env.DATABASE_URL) {
  throw new Error("DATABASE_URL is empty! Check your .env file.");
}

// better-auth runs inside the Next.js app, so its public URL is the frontend URL.
// Express only *verifies* the JWTs that better-auth issues, using its JWKS endpoint.
// Remove spaces and trailing slashes: "https://site.com/" would never match the browser's Origin.
const clean = (url: string) => url.trim().replace(/\/+$/, "");
const clientUrl = clean(process.env.CLIENT_URL ?? "http://localhost:3000");
const authBaseUrl = clean(process.env.AUTH_BASE_URL ?? clientUrl);

interface Config {
  PORT: number;
  DATABASE_URL: string;
  CLIENT_URL: string;
  /** Must equal BETTER_AUTH_URL in the frontend (it is the JWT issuer + audience). */
  AUTH_BASE_URL: string;
  /** Where Express downloads the public keys used to verify JWT signatures. */
  AUTH_JWKS_URL: string;
}

const config: Config = {
  PORT: Number(process.env.PORT) || 5000,
  DATABASE_URL: process.env.DATABASE_URL,
  CLIENT_URL: clientUrl,
  AUTH_BASE_URL: authBaseUrl,
  AUTH_JWKS_URL: process.env.AUTH_JWKS_URL ?? `${authBaseUrl}/api/auth/jwks`,
};

export default config;
