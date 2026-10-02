import { execSync } from "node:child_process";
import { getTestDatabaseUrl } from "./testDb";

// Brings the test database to the latest migration before any test runs.
export default function setup() {
  const url = getTestDatabaseUrl();
  if (process.env.SKIP_TEST_MIGRATE) return; // for environments where the schema is managed by hand
  execSync("npx prisma migrate deploy", {
    cwd: process.cwd(),
    stdio: "inherit",
    env: { ...process.env, DATABASE_URL: url },
  });
}
