import "dotenv/config";

/** Resolves the test database URL and refuses to run against anything that isn't clearly a test database. */
export function getTestDatabaseUrl(): string {
  const url = process.env.TEST_DATABASE_URL;
  if (!url) {
    throw new Error("TEST_DATABASE_URL is not set. Add it to backend/.env (see .env.example).");
  }
  const dbName = new URL(url).pathname.replace(/^\//, "");
  if (!dbName.endsWith("_test")) {
    throw new Error(`Refusing to run tests: database "${dbName}" does not end with "_test" (tests delete all data).`);
  }
  return url;
}
