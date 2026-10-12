import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Guards a design decision rather than a behaviour: PostgreSQL (through the API) is the only source of truth, and
 * the browser stores nothing — no persisted Zustand state, no tokens in storage. If this fails, someone added
 * client-side persistence; that needs a deliberate decision, not an accident.
 */
const ROOT = path.resolve(__dirname, "..");
const SOURCE_DIRS = ["app", "components", "hooks", "lib", "store", "types"];

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) return files(full);
    return /\.(ts|tsx)$/.test(name) ? [full] : [];
  });
}

const sources = SOURCE_DIRS.flatMap((d) => files(path.join(ROOT, d))).map((file) => ({ file: path.relative(ROOT, file), text: readFileSync(file, "utf8") }));

const FORBIDDEN: [string, RegExp][] = [
  ["localStorage", /\blocalStorage\b/],
  ["sessionStorage", /\bsessionStorage\b/],
  ["IndexedDB", /\bindexedDB\b/],
  ["zustand persist middleware", /zustand\/middleware/],
  ["persist(...)", /\bpersist\s*\(/],
  ["document.cookie (the session cookie is HTTP-only)", /\bdocument\.cookie\b/],
];

describe("architecture: no client-side persistence", () => {
  it("scans a meaningful amount of source", () => {
    expect(sources.length).toBeGreaterThan(40);
  });

  for (const [label, pattern] of FORBIDDEN) {
    it(`no source file uses ${label}`, () => {
      const offenders = sources.filter((s) => pattern.test(s.text.replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, ""))).map((s) => s.file); // comments may mention them
      expect(offenders).toEqual([]);
    });
  }

  it("every store lives in store/ and is created with plain zustand create()", () => {
    const stores = sources.filter((s) => s.file.startsWith("store/") && /\bcreate[<(]/.test(s.text));
    expect(stores.length).toBeGreaterThanOrEqual(8);
  });

  it("every user-scoped cache registers itself for cleanup when the session ends", () => {
    // These hold one user's data; each must be wired to resetOnSessionChange (see store/sessionScope.ts).
    const mustReset = ["store/useBoardStore.ts", "store/useBoardListStore.ts", "store/useCommentStore.ts", "store/createActivityStore.ts", "store/useTaskPanelStore.ts"];
    const missing = mustReset.filter((f) => !sources.find((s) => s.file === f)?.text.includes("resetOnSessionChange("));
    expect(missing).toEqual([]);
  });
});
