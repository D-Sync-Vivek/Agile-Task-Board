export type Id = string | number

export type Task = {
    id: Id;
    content: string;
    columnId: Id;
}

export type Column ={
    id: Id;
    title: string;
}

export interface KanbanStore{
    updateColumnTitle: any;
    // 1. Primitive State
    columns: Column[];
    tasks: Task[];

    // 2. Actions
    addColumn: (title: string) => void;
    deleteColumn: (id: Id) => void;

    addTask: (columnId: Id) => void;
    deleteTask: (id: Id) => void;
    updateTask: (id: Id, content: string) => void;

    setTasks: (tasks: Task[]) => void;
    setColumns: (columns: Column[]) => void;
}