import "dotenv/config";
import { z } from "zod";

const schema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().int().positive().default(4000),
  DATABASE_URL: z.string().min(1, "DATABASE_URL is required"),
  JWT_SECRET: z.string().min(32, "JWT_SECRET must be at least 32 characters"),
  JWT_EXPIRES_IN_DAYS: z.coerce.number().int().positive().default(7),
  // Origin of the Next.js app (scheme + host + port, no path). Used for CORS and the CSRF origin check.
  CLIENT_ORIGIN: z.url().transform((v) => new URL(v).origin),
  // Number of reverse proxies in front of the app (e.g. 1 on Render/Railway) so rate limiting sees real client IPs.
  TRUST_PROXY: z.coerce.number().int().min(0).default(0),
  BCRYPT_ROUNDS: z.coerce.number().int().min(4).max(15).default(12),
  AUTH_RATE_LIMIT_MAX: z.coerce.number().int().positive().default(10),
  AUTH_RATE_LIMIT_WINDOW_MINUTES: z.coerce.number().int().positive().default(15),
  // "none" is required when frontend and API live on different sites (e.g. Vercel + Render); it forces Secure cookies.
  COOKIE_SAME_SITE: z.enum(["lax", "strict", "none"]).optional(),
});

const parsed = schema.safeParse(process.env);

if (!parsed.success) {
  const problems = parsed.error.issues.map((i) => `  - ${i.path.join(".")}: ${i.message}`).join("\n");
  throw new Error(`Invalid environment configuration:\n${problems}`);
}

const data = parsed.data;
const isProduction = data.NODE_ENV === "production";
const sameSite = data.COOKIE_SAME_SITE ?? (isProduction ? "none" : "lax");

export const env = {
  ...data,
  isProduction,
  cookieSameSite: sameSite,
  // Browsers reject SameSite=None cookies that aren't Secure.
  cookieSecure: isProduction || sameSite === "none",
};
