"use client"
import { Column } from "@/types"
import { useKanbanStore } from "@/store/useKanbanStore"
import { useSortable } from "@dnd-kit/sortable"
import { CSS } from "@dnd-kit/utilities"
import { SortableContext } from "@dnd-kit/sortable"
import TaskCard from "./TaskCard"
import { useMemo } from "react"

const ColumnContainer = ({ column }: { column: Column }) => {

    const addTask = useKanbanStore((state) => state.addTask);
    const deleteColumn = useKanbanStore((state) => state.deleteColumn)

    const tasks = useKanbanStore((state) => state.tasks)

    const columnTasks = useMemo(() => {
        return tasks.filter((tasks) => tasks.columnId === column.id);
    }, [tasks, column.id]);

    const tasksIDs = useMemo(() => {
        return columnTasks.map((task) => task.id);
    }, [columnTasks])

    const {
        setNodeRef,
        attributes,
        listeners,
        transform,
        transition,
        isDragging
    } = useSortable({
        id: column.id,
        data: {
            type: "Column",
            column
        }
    })

    const style = {
        transform: CSS.Transform.toString(transform),
        transition
    }

    if (isDragging) {
        return (
            <div
                ref={setNodeRef}
                style={style}
                className="bg-gray-100 opacity-40 border-2 border-rose-500 w-87.5 h-125 max-h-125 rounded-md flex flex-col"
            ></div>
        );
    }

    function callDeleteColumn() {
        const id = column.id
        deleteColumn(id)
    }
    return (

        <div
            ref={setNodeRef}
            style={style}
            className="bg-gray-100 w-87.5 h-125 max-h-125 rounded-md flex flex-col"
        >
            {/* Column Header */}
            <div
                {...attributes}
                {...listeners}
                className="bg-blue-400 text-md h-15 cursor-grab rounded-md rounded-b-none p-3 font-bold border-blue-500 border-2 flex items-center justify-between"
            >
                <div className="flex gap-2">
                    <div className="flex justify-center items-center bg-cyan-400 px-2 py-1 text-sm rounded-full">
                        {columnTasks.length}
                    </div>
                    {column.title}
                </div>

                <button
                    onClick={() => deleteColumn(column.id)}
                    className="stroke-gray-500 hover:stroke-white hover:bg-cyan-400 rounded px-1 py-2"
                >
                    🗑️
                </button>
            </div>
            {/* Column Body (Task List) */}
            <div className="flex grow flex-col gap-4 p-2 overflow-x-hidden overflow-y-auto">
                <SortableContext items={tasksIDs}>
                    {columnTasks.map((task) => (
                        <TaskCard key={task.id} task={task}/>
                    ))}
                </SortableContext>
            </div>


            {/* Column Footer (Add Task Button) */}
            <button
                className="flex gap-2 items-center border-cyan-400 border-2 rounded-md p-4 border-x-cyan-400 hover:bg-blue-400 hover:text-rose-500 active:bg-black"
                onClick={() => {
                    addTask(column.id)
                }}
            >
                <span className="text-xl">+</span> Add Task
            </button>
        </div>

    )
}

export default ColumnContainer
