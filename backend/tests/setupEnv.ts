import { getTestDatabaseUrl } from "./testDb";

// Runs in every test worker BEFORE src/config/env.ts is imported.
process.env.NODE_ENV = "test";
process.env.DATABASE_URL = getTestDatabaseUrl();
process.env.JWT_SECRET = "test-secret-test-secret-test-secret-123456";
process.env.CLIENT_ORIGIN = "http://localhost:3000";
process.env.BCRYPT_ROUNDS = "4"; // fast hashing; production default is 12
process.env.COOKIE_SAME_SITE = "lax";
process.env.AUTH_RATE_LIMIT_MAX = "1000";
