import { create } from "zustand";
import type { ActivityDto, ActivityPage } from "@/types/api";
import { getErrorMessage, isApiError } from "@/lib/errors";
import { resetOnSessionChange } from "@/store/sessionScope";
import { useAuthStore } from "@/store/useAuthStore";

/**
 * Read-only cache of an activity feed (newest first, loaded a page at a time). The server is the source of truth:
 * entries are never created or edited on the client, only re-fetched — which is why there is no optimistic logic here.
 *
 * The same logic serves two feeds (the whole board, and one task inside its detail panel), so it is a factory;
 * each feed gets its own store and the two can be open at once without interfering.
 */

type Status = "idle" | "loading" | "ready" | "error";

export interface ActivityFeedState {
  /** What is being shown (a board id or a task id); a stale response for a previous scope is discarded. */
  scopeId: string | null;
  entries: ActivityDto[];
  nextCursor: string | null;
  status: Status;
  error: string | null;
  loadingMore: boolean;
  loadMoreError: string | null;

  /** First page, replacing whatever was shown (use when the scope changes). */
  load: (scopeId: string, options?: { signal?: AbortSignal }) => Promise<void>;
  /** First page again WITHOUT blanking the list; if it fails the current entries stay and nothing is shown to the user. */
  refresh: () => Promise<void>;
  loadMore: () => Promise<void>;
  /** An entry pushed by the server. Shown on top if it belongs to this feed and isn't there yet. */
  receive: (entry: ActivityDto) => void;
  reset: () => void;
}

export type FetchActivityPage = (scopeId: string, params: { limit?: number; cursor?: string }, options?: { signal?: AbortSignal }) => Promise<ActivityPage>;

const PAGE_SIZE = 20;
const initial = { scopeId: null, entries: [] as ActivityDto[], nextCursor: null, status: "idle" as Status, error: null, loadingMore: false, loadMoreError: null };

/**
 * @param belongsToScope  does a pushed entry belong in the feed currently shown (the board's, or one task's)?
 */
export function createActivityStore(fetchPage: FetchActivityPage, belongsToScope: (entry: ActivityDto, scopeId: string) => boolean) {
  // load/refresh/reset bump `listVersion`; only the newest list request may write the list, so a slow older response
  // can't overwrite a newer one. loadMore remembers the version it started under and drops its page if the list was
  // replaced meanwhile (the user can simply press "Load more" again).
  let listVersion = 0;
  let pushedWhileLoading = false; // an entry arrived while the first page was loading: that page may predate it

  const handle401 = (error: unknown) => {
    if (isApiError(error, 401)) useAuthStore.getState().markAnonymous();
  };

  const useStore = create<ActivityFeedState>((set, get) => ({
    ...initial,

    load: async (scopeId, { signal } = {}) => {
      const ticket = ++listVersion;
      pushedWhileLoading = false;
      set({ ...initial, scopeId, status: "loading" });
      try {
        const page = await fetchPage(scopeId, { limit: PAGE_SIZE }, { signal });
        if (ticket !== listVersion || signal?.aborted) return;
        set({ entries: page.activities, nextCursor: page.nextCursor, status: "ready", error: null });
        if (pushedWhileLoading) {
          pushedWhileLoading = false;
          void get().refresh();
        }
      } catch (error) {
        if (ticket !== listVersion || signal?.aborted) return;
        handle401(error);
        set({ status: "error", error: getErrorMessage(error, "Unable to load activity.") });
      }
    },

    refresh: async () => {
      const { scopeId, status } = get();
      if (!scopeId || status !== "ready") return;
      const ticket = ++listVersion;
      try {
        const page = await fetchPage(scopeId, { limit: PAGE_SIZE });
        if (ticket !== listVersion) return;
        // The fresh page is the newest N entries, so everything it doesn't contain is older: keep the pages the user
        // already scrolled through below it (and their cursor); otherwise the fresh page's own cursor applies.
        const fresh = new Set(page.activities.map((a) => a.id));
        const merged = [...page.activities, ...get().entries.filter((a) => !fresh.has(a.id))];
        set({ entries: merged, nextCursor: merged.length > page.activities.length ? get().nextCursor : page.nextCursor, error: null });
      } catch (error) {
        if (ticket !== listVersion) return;
        handle401(error); // any other failure: keep showing what we have
      }
    },

    loadMore: async () => {
      const { scopeId, nextCursor, loadingMore, status } = get();
      if (!scopeId || !nextCursor || loadingMore || status !== "ready") return;
      const startedUnder = listVersion;
      set({ loadingMore: true, loadMoreError: null });
      try {
        const page = await fetchPage(scopeId, { limit: PAGE_SIZE, cursor: nextCursor });
        if (get().scopeId !== scopeId) return; // load/reset already cleared loadingMore
        if (startedUnder !== listVersion) {
          set({ loadingMore: false });
          return;
        }
        const known = new Set(get().entries.map((a) => a.id));
        set((s) => ({ entries: [...s.entries, ...page.activities.filter((a) => !known.has(a.id))], nextCursor: page.nextCursor, loadingMore: false }));
      } catch (error) {
        if (get().scopeId !== scopeId) return;
        handle401(error);
        set({ loadingMore: false, loadMoreError: getErrorMessage(error, "Couldn't load more activity.") });
      }
    },

    receive: (entry) => {
      const { scopeId, status, entries } = get();
      if (!scopeId || !belongsToScope(entry, scopeId)) return;
      if (status === "loading") {
        pushedWhileLoading = true;
        return;
      }
      if (status !== "ready" || entries.some((e) => e.id === entry.id)) return;
      set({ entries: [entry, ...entries] });
    },

    reset: () => {
      listVersion++;
      set({ ...initial });
    },
  }));

  resetOnSessionChange(() => useStore.getState().reset());
  return useStore;
}
