import { create } from "zustand";
import { KanbanStore} from "@/types";

function generateRandomID(){
    return Math.floor(Math.random() * 1000 + 1);
}

export const useKanbanStore = create<KanbanStore>((set) => ({
    columns: [],
    tasks: [],

    addColumn: (title) => set((state) => ({
       columns: [...state.columns, {id: generateRandomID(), title}]
    })),

    addTask: (columnId) => set((state) => ({
        tasks: [...state.tasks, {id: generateRandomID(), columnId, content: "New Task"}]
    })),

    deleteColumn: (id) => set((state) => ({
        columns: state.columns.filter((col) => col.id !== id),
        tasks: state.tasks.filter((task) => task.columnId !== id)
    })), 

    deleteTask: (id) => set((state) => ({
        tasks: state.tasks.filter((task) => task.id !== id)
    })),

    setTasks: (newTasks) => set({tasks: newTasks}),
    setColumns: (newCols) => set({columns: newCols}),
    updateTask: (id, content) => set((state) => ({
        tasks: state.tasks.map((task) => 
            task.id === id ? {...task, content} : task
        )
    }))
}));
