import { useAuthStore } from "@/store/useAuthStore";

/**
 * Everything the stores cache (boards, tasks, comments, activity…) belongs to ONE signed-in user. When that user
 * goes away — logs out, the session expires, or a different account signs in on the same tab — the cache must go
 * with them, otherwise the next person to sign in could briefly see the previous user's data.
 *
 * Each user-scoped store registers its own reset here, so the rule lives next to the data it protects and a new
 * store can't forget it by accident. (It can't live in useAuthStore: that would import every store, and they all
 * import useAuthStore.)
 */
export function resetOnSessionChange(reset: () => void): void {
  useAuthStore.subscribe((state, previous) => {
    const hadUser = previous.user !== null;
    if (hadUser && state.user?.id !== previous.user?.id) reset();
  });
}
