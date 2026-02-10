"use client"
import { Column } from "@/types"
import { useKanbanStore } from "@/store/useKanbanStore"
import { useSortable } from "@dnd-kit/sortable"
import { CSS } from "@dnd-kit/utilities"
import { SortableContext } from "@dnd-kit/sortable"
import TaskCard from "./TaskCard"
import { useEffect, useMemo, useState } from "react"

const ColumnContainer = ({ column }: { column: Column }) => {

    const [isEditModeOn, setIsEditModeOn] = useState(false)
    const [title, setTitle] = useState("");

    const addTask = useKanbanStore((state) => state.addTask);
    const deleteColumn = useKanbanStore((state) => state.deleteColumn)
    const updateTitle = useKanbanStore((state) => state.updateColumnTitle)

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
        },
        disabled: isEditModeOn
    })

    const style = {
        transform: CSS.Transform.toString(transform),
        transition
    }

    const toggleEditMode = () => {
        setIsEditModeOn((prev) => !prev);
    }

    const saveTitle = () => {
        setIsEditModeOn(false);
        if (title !== column.title) {
            updateTitle(column.id, title)
        }
    }

    if (isDragging) {
        return (
            <div
                ref={setNodeRef}
                style={style}
                className="bg-gray-100 opacity-40 border-2 border-gray-500 w-75 md:w-(--column-width) h-(--column-height) max-h-[80vh] rounded-md flex flex-col snap-center"
            ></div>
        );
    }

    return (

        <div
            ref={setNodeRef}
            style={style}
            className="bg-gray-900 w-75 md:w-(--column-width) h-150 md:h-(--column-height) max-h-[80vh] rounded-md flex flex-col snap-center"
        >
            {/* Column Header */}
            <div
                {...attributes}
                {...listeners}
                onDoubleClick={toggleEditMode}
                className="bg-gray-900 text-md h-15 cursor-grab rounded-md rounded-b-none p-3 font-bold border-(--main-bg-color) border-2 flex items-center justify-between"
            >
                {isEditModeOn ? 
                (<input
                    autoFocus 
                    placeholder="Enter title"
                    className="w-full border-none rounded bg-transparent text-white focus:outline-none"
                    onBlur={saveTitle}
                    value={title}
                    onKeyDown={(e) => {
                        if(e.key === "Enter"){
                            saveTitle();
                        }
                    }}
                    onChange={(e) => setTitle(e.target.value)}
                ></input>)
                    :
                    <div className="flex gap-2 text-white">
                        <div className="flex justify-center items-center text-black bg-blue-100 px-2 py-1 text-sm rounded-full">
                            {columnTasks.length}
                        </div>
                        {column.title}
                    </div>}

                {!isEditModeOn && (
                    <button
                        onClick={(e) => {
                            e.stopPropagation();
                            deleteColumn(column.id)
                        }}
                        className="stroke-gray-500 hover:stroke-white hover:bg-red-500 rounded px-1 py-2"
                    >
                        <img src="/trash.gif" alt="delete" width={30} />
                    </button>
                )}
            </div>
            {/* Column Body (Task List) */}
            <div className="flex grow flex-col gap-4 p-2 overflow-x-hidden overflow-y-auto">
                <SortableContext items={tasksIDs}>
                    {columnTasks.map((task) => (
                        <TaskCard key={task.id} task={task} />
                    ))}
                </SortableContext>
            </div>


            {/* Column Footer (Add Task Button) */}
            <button
                className=" border-gray-800 border-2 rounded-md p-4 border-x-0 border-b-0 hover:bg-gray-800 hover:text-rose-500 text-gray-500 cursor-pointer active:bg-black transition-colors"
                onClick={() => {
                    addTask(column.id)
                }}
            >
                + Add Task
            </button>
        </div>

    )
}

export default ColumnContainer
