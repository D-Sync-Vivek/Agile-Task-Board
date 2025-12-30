import { create } from "zustand";
import { Id, KanbanStore } from "@/types";
import { persist } from "zustand/middleware";

function generateRandomID() {
  return crypto.randomUUID();
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
            { id: generateRandomID(), columnId, content: "New Task" },
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
      updateColumnTitle: (id: Id, title: string) =>
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
