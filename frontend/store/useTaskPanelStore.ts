import { create } from "zustand";
import type { Id } from "@/types";

/** Which task's detail panel is open (UI state only; the task data itself lives in useBoardStore). */
interface TaskPanelState {
  taskId: Id | null;
  open: (taskId: Id) => void;
  close: () => void;
}

export const useTaskPanelStore = create<TaskPanelState>((set) => ({
  taskId: null,
  open: (taskId) => set({ taskId }),
  close: () => set({ taskId: null }),
}));
