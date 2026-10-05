import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { toast, useToastStore } from "@/store/useToastStore";

beforeEach(() => {
  vi.useFakeTimers();
  useToastStore.setState({ toasts: [] });
});
afterEach(() => vi.useRealTimers());

describe("toast store", () => {
  it("shows a toast and removes it automatically", () => {
    toast.error("Boom");
    expect(useToastStore.getState().toasts).toMatchObject([{ kind: "error", message: "Boom" }]);
    vi.advanceTimersByTime(6001);
    expect(useToastStore.getState().toasts).toEqual([]);
  });

  it("can be dismissed early and keeps only the newest few", () => {
    for (let i = 1; i <= 6; i++) toast.success(`m${i}`);
    expect(useToastStore.getState().toasts.map((t) => t.message)).toEqual(["m3", "m4", "m5", "m6"]);
    const { toasts, dismiss } = useToastStore.getState();
    dismiss(toasts[0].id);
    expect(useToastStore.getState().toasts).toHaveLength(3);
  });
});
