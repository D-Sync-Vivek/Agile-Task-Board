"use client";
import { useNow } from "@/hooks/useNow";
import { actorName, describeActivity } from "@/lib/activity";
import { formatRelativeTime, formatTimestamp } from "@/lib/dates";
import { useAuthStore } from "@/store/useAuthStore";
import type { createActivityStore } from "@/store/createActivityStore";

type ActivityStore = ReturnType<typeof createActivityStore>;

interface Props {
  /** Which feed to show (the board's or one task's). */
  store: ActivityStore;
  onRetry: () => void;
  emptyText?: string;
}

/** The list + its loading / error / empty / "load more" states. Loading the feed is the parent's job. */
export default function ActivityFeed({ store, onRetry, emptyText = "No activity yet." }: Props) {
  const entries = store((s) => s.entries);
  const status = store((s) => s.status);
  const error = store((s) => s.error);
  const nextCursor = store((s) => s.nextCursor);
  const loadingMore = store((s) => s.loadingMore);
  const loadMoreError = store((s) => s.loadMoreError);
  const loadMore = store((s) => s.loadMore);
  const me = useAuthStore((s) => s.user?.id);
  const now = useNow();

  if (status === "idle" || status === "loading") return <p role="status" className="text-sm text-gray-400">Loading activity…</p>;

  if (status === "error") {
    return (
      <div role="alert" className="flex items-center gap-3 text-sm text-gray-300">
        <span>{error ?? "Unable to load activity."}</span>
        <button type="button" onClick={onRetry} className="rounded bg-gray-800 px-3 py-1 hover:bg-gray-700">Retry</button>
      </div>
    );
  }

  if (entries.length === 0) return <p className="text-sm text-gray-500">{emptyText}</p>;

  return (
    <div>
      <ul className="space-y-3">
        {entries.map((entry) => (
          <li key={entry.id} className="text-sm leading-snug text-gray-300">
            <span className="font-semibold text-white">{actorName(entry, me)}</span> {describeActivity(entry)}
            <div className="mt-0.5 text-xs text-gray-500" title={formatTimestamp(entry.createdAt)}>{formatRelativeTime(entry.createdAt, now)}</div>
          </li>
        ))}
      </ul>

      {loadMoreError && <p role="alert" className="mt-3 text-xs text-red-400">{loadMoreError}</p>}
      {nextCursor && (
        <button type="button" onClick={() => void loadMore()} disabled={loadingMore} className="mt-4 rounded border border-gray-700 px-3 py-1.5 text-sm text-gray-200 hover:bg-gray-800 disabled:opacity-50">
          {loadingMore ? "Loading…" : "Load more"}
        </button>
      )}
    </div>
  );
}
