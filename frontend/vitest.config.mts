import path from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: { alias: { "@": path.resolve(__dirname) } },
  // tsconfig uses jsx: "preserve" for Next; tests need the automatic React runtime (Vite 8 transforms with Oxc).
  oxc: { jsx: { runtime: "automatic" } },
  test: {
    environment: "node", // component tests opt in with `// @vitest-environment jsdom`
    include: ["tests/**/*.test.{ts,tsx}"],
    exclude: ["tests/integration/**"],
    setupFiles: ["tests/setup.ts"],
  },
});
