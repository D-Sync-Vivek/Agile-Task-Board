import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { Id } from "@/types";

// Legacy local-only board shapes. These are intentionally separate from the
// server-backed Task/Column types in "@/types", which no longer have `content`.
export interface LegacyColumn {
  id: Id;
  title: string;
}

export interface LegacyTask {
  id: Id;
  columnId: Id;
  content: string;
}

export interface KanbanStore {
  columns: LegacyColumn[];
  tasks: LegacyTask[];
  addColumn: (title: string) => void;
  addTask: (columnId: Id) => void;
  deleteColumn: (id: Id) => void;
  deleteTask: (id: Id) => void;
  setTasks: (tasks: LegacyTask[]) => void;
  setColumns: (columns: LegacyColumn[]) => void;
  updateColumnTitle: (id: Id, title: string) => void;
  updateTask: (id: Id, content: string) => void;
}

function generateRandomID() {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return Date.now().toString(36) + Math.random().toString(36).substring(2);
}

export const useKanbanStore = create<KanbanStore>()(
  persist(
    (set) => ({
      columns: [],
      tasks: [],

      addColumn: (title) =>
        set((state) => ({
          columns: [...state.columns, { id: generateRandomID(), title }],
        })),

      addTask: (columnId) =>
        set((state) => ({
          tasks: [
            ...state.tasks,
            { id: generateRandomID(), columnId, content: "Double Click to edit" },
          ],
        })),

      deleteColumn: (id) =>
        set((state) => ({
          columns: state.columns.filter((col) => col.id !== id),
          tasks: state.tasks.filter((task) => task.columnId !== id),
        })),

      deleteTask: (id) =>
        set((state) => ({
          tasks: state.tasks.filter((task) => task.id !== id),
        })),

      setTasks: (newTasks) => set({ tasks: newTasks }),
      setColumns: (newCols) => set({ columns: newCols }),
      updateColumnTitle: (id, title) =>
        set((state) => ({
          columns: state.columns.map((col) =>
            col.id === id ? { ...col, title } : col
          ),
        })),
      updateTask: (id, content) =>
        set((state) => ({
          tasks: state.tasks.map((task) =>
            task.id === id ? { ...task, content } : task
          ),
        })),
    }),
    {
      name: "kanban-storage",
    }
  )
);