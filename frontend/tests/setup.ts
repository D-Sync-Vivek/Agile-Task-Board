import "@testing-library/jest-dom/vitest";
import { cleanup } from "@testing-library/react";
import { afterEach } from "vitest";

// Vitest has no globals, so React Testing Library can't auto-register its cleanup.
afterEach(() => cleanup());
