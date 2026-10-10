"use client";
import { useEffect, useRef } from "react";
import ActivityFeed from "@/components/Kanban/ActivityFeed";
import { useCommentStore } from "@/store/useCommentStore";
import { useTaskActivityStore } from "@/store/useActivityStores";

interface Props {
  taskId: string;
  /** Changes whenever the server saved a change to the task: the cue to re-read its history. */
  updatedAt: string;
}

/** "Activity" block of the task detail panel. Shows this task's history, including comments posted on it. */
export default function TaskActivitySection({ taskId, updatedAt }: Props) {
  const load = useTaskActivityStore((s) => s.load);
  const refresh = useTaskActivityStore((s) => s.refresh);
  const reset = useTaskActivityStore((s) => s.reset);

  useEffect(() => {
    const controller = new AbortController();
    void load(taskId, { signal: controller.signal });
    return () => {
      controller.abort();
      reset();
    };
  }, [taskId, load, reset]);

  // The task was saved (edit / assign): its history just gained an entry.
  const lastUpdatedAt = useRef(updatedAt);
  useEffect(() => {
    if (lastUpdatedAt.current === updatedAt) return;
    lastUpdatedAt.current = updatedAt;
    void refresh();
  }, [updatedAt, refresh]);

  // A comment was posted (the server confirmed it): "commented on …" is a new entry. The first load of the comment
  // list is not a new comment, so the count is only compared once it has been seen.
  const commentsReady = useCommentStore((s) => s.status === "ready");
  const committedComments = useCommentStore((s) => s.comments.filter((c) => !c.pending).length);
  const lastCount = useRef<number | null>(null);
  useEffect(() => {
    if (!commentsReady) {
      lastCount.current = null;
      return;
    }
    if (lastCount.current !== null && committedComments > lastCount.current) void refresh();
    lastCount.current = committedComments;
  }, [commentsReady, committedComments, refresh]);

  return (
    <section aria-labelledby="task-activity-heading" className="mt-8 border-t border-gray-800 pt-4">
      <h3 id="task-activity-heading" className="mb-3 text-sm font-semibold text-gray-200">Activity</h3>
      <ActivityFeed store={useTaskActivityStore} onRetry={() => void load(taskId)} emptyText="No activity yet." />
    </section>
  );
}
