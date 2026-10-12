import { api } from "@/lib/api";
import { createActivityStore } from "@/store/createActivityStore";

/** The activity feed of the open board (header "Activity" drawer). */
export const useBoardActivityStore = createActivityStore(
  (boardId, params, options) => api.activity.forBoard(boardId, params, options),
  (entry, boardId) => entry.boardId === boardId
);

/** The activity of the task whose detail panel is open. */
export const useTaskActivityStore = createActivityStore(
  (taskId, params, options) => api.activity.forTask(taskId, params, options),
  // Mirrors the server's rule for GET /tasks/:id/activity: the task's own events, plus comments posted on it.
  (entry, taskId) => (entry.entityType === "TASK" && entry.entityId === taskId) || (entry.action === "COMMENT_ADDED" && entry.metadata.taskId === taskId)
);
