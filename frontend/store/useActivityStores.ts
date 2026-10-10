import { api } from "@/lib/api";
import { createActivityStore } from "@/store/createActivityStore";

/** The activity feed of the open board (header "Activity" drawer). */
export const useBoardActivityStore = createActivityStore((boardId, params, options) => api.activity.forBoard(boardId, params, options));

/** The activity of the task whose detail panel is open. */
export const useTaskActivityStore = createActivityStore((taskId, params, options) => api.activity.forTask(taskId, params, options));
