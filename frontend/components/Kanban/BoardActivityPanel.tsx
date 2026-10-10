"use client";
import { useEffect, useRef } from "react";
import ActivityFeed from "@/components/Kanban/ActivityFeed";
import { useDialogFocus } from "@/hooks/useDialogFocus";
import { useBoardActivityStore } from "@/store/useActivityStores";

interface Props {
  boardId: string;
  onClose: () => void;
}

/** Slide-over with the whole board's history. Mounted only while open, so it loads fresh data every time. */
export default function BoardActivityPanel({ boardId, onClose }: Props) {
  const load = useBoardActivityStore((s) => s.load);
  const reset = useBoardActivityStore((s) => s.reset);
  const dialogRef = useRef<HTMLDivElement>(null);
  useDialogFocus(dialogRef, onClose);

  useEffect(() => {
    const controller = new AbortController();
    void load(boardId, { signal: controller.signal });
    return () => {
      controller.abort();
      reset();
    };
  }, [boardId, load, reset]);

  return (
    <div className="fixed inset-0 z-40 flex justify-end">
      <div className="absolute inset-0 bg-black/60" aria-hidden="true" onClick={onClose} />
      <div ref={dialogRef} role="dialog" aria-modal="true" aria-labelledby="board-activity-heading" className="relative h-full w-full max-w-md overflow-y-auto border-l border-gray-800 bg-gray-900 p-6 shadow-2xl">
        <div className="mb-4 flex items-start justify-between gap-4">
          <h2 id="board-activity-heading" className="text-lg font-semibold text-white">Board activity</h2>
          <button type="button" onClick={onClose} aria-label="Close activity" className="rounded px-2 text-2xl leading-none text-gray-400 hover:text-white">×</button>
        </div>
        <ActivityFeed store={useBoardActivityStore} onRetry={() => void load(boardId)} emptyText="No activity on this board yet." />
      </div>
    </div>
  );
}
