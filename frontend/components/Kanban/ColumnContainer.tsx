"use client"
import { Column } from "@/types"
import { useBoardStore } from "@/store/useBoardStore"
import { useCan } from "@/hooks/useCan"
import { useSortable } from "@dnd-kit/sortable"
import { CSS } from "@dnd-kit/utilities"
import { SortableContext } from "@dnd-kit/sortable"
import TaskCard from "./TaskCard"
import { useMemo, useState } from "react"

const ColumnContainer = ({ column }: { column: Column }) => {

    const [isEditModeOn, setIsEditModeOn] = useState(false)
    const [title, setTitle] = useState("");

    const addTask = useBoardStore((state) => state.addTask);
    const deleteColumn = useBoardStore((state) => state.deleteColumn)
    const renameColumn = useBoardStore((state) => state.renameColumn)
    const isAddingTask = useBoardStore((state) => state.addingTaskIn.includes(column.id))
    const canRename = useCan("column:update")
    const canDeleteColumn = useCan("column:delete")
    const canAddTask = useCan("task:create")

    const tasks = useBoardStore((state) => state.tasks)

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
        disabled: isEditModeOn || !canRename
    })

    const style = {
        transform: CSS.Transform.toString(transform),
        transition
    }

    const toggleEditMode = () => {
        if (!canRename) return;
        if (!isEditModeOn) setTitle(column.title); // start from the current title (it used to open empty)
        setIsEditModeOn((prev) => !prev);
    }

    const saveTitle = () => {
        setIsEditModeOn(false);
        renameColumn(column.id, title) // the store ignores blank/unchanged titles
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

                {!isEditModeOn && canDeleteColumn && (
                    <button
                        aria-label={`Delete column ${column.title}`}
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
            {canAddTask && (
                <button
                    disabled={isAddingTask}
                    className=" border-gray-800 border-2 rounded-md p-4 border-x-0 border-b-0 hover:bg-gray-800 hover:text-rose-500 text-gray-500 cursor-pointer active:bg-black transition-colors disabled:cursor-wait disabled:opacity-60"
                    onClick={() => {
                        addTask(column.id)
                    }}
                >
                    + Add Task
                </button>
            )}
        </div>

    )
}

export default ColumnContainer
