import path from "node:path";
import { defineConfig } from "vitest/config";

// Opt-in: needs a running backend (see tests/integration/README note in the test file header).
export default defineConfig({
  resolve: { alias: { "@": path.resolve(__dirname) } },
  test: { environment: "node", include: ["tests/integration/**/*.test.ts"], testTimeout: 20_000, fileParallelism: false },
});
