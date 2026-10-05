import { Task } from "@/types"
import { useSortable } from "@dnd-kit/sortable"
import { CSS } from "@dnd-kit/utilities"
import { useBoardStore } from "@/store/useBoardStore"
import { useCan } from "@/hooks/useCan"
import { useState } from "react"

interface Props {
    task: Task;
}

const TaskCard = ({ task }: Props) => {
    const deleteTask = useBoardStore((state) => state.deleteTask);
    const updateTaskTitle = useBoardStore((state) => state.updateTaskTitle);
    const canUpdate = useCan("task:update");
    const canMove = useCan("task:move");
    const canDelete = useCan("task:delete");

    const [isEditModeOn, setIsEditModeOn] = useState(false);
    const [newContent, setNewContent] = useState("");

    const {
        setNodeRef,
        attributes,
        listeners,
        transform,
        transition,
        isDragging
    } = useSortable({
        id: task.id,
        data: {
            type: "Task",
            task
        },
        disabled: isEditModeOn || !canMove
    })

    const style = {
        transition,
        transform: CSS.Transform.toString(transform)
    }

    const toggleEditMode = () => {
        if (!canUpdate) return;
        if (!isEditModeOn) setNewContent(task.title); // start from the current text (it used to open empty)
        setIsEditModeOn((prev) => !prev);
    }

    const saveTask = () => {
        setIsEditModeOn(false);
        updateTaskTitle(task.id, newContent); // the store ignores blank/unchanged text
    }

    if (isDragging) {
        return (
            <div
                ref={setNodeRef}
                style={style}
                className="opacity-50 bg-gray-800 p-2.5 h-25 min-h-25 items-center flex text-left rounded-xl border-2 border-rose-500 cursor-grab relative"
            />
        )
    }

    return (
        <div
            ref={setNodeRef}
            style={style}
            {...attributes}
            {...listeners}
            onDoubleClick={toggleEditMode}
            className="bg-gray-800 p-2.5 h-25 min-h-25 items-center flex text-left rounded-xl hover:ring-2 hover:ring-inset hover:ring-rose-500 cursor-grab relative task text-gray-100 shadow-sm"
        >
            {isEditModeOn ? (
                <textarea
                    className="h-[90%] w-full resize-none border-none rounded bg-transparent text-white focus:outline-none placeholder-gray-500"
                    value={newContent}
                    autoFocus
                    placeholder="Task Content here"
                    onBlur={saveTask}
                    onKeyDown={(e) => {
                        if (e.key === "Enter" && !e.shiftKey) {
                            saveTask();
                        }
                    }}
                    onChange={(e) => setNewContent(e.target.value)}
                ></textarea>
            ) : (
                <p className="my-auto h-[90%] w-[80%] overflow-y-auto overflow-x-hidden whitespace-pre-wrap">{task.title}</p>
            )
            }

            {/* Conditionally rendering delete button only when Not editing. */}
            {!isEditModeOn && canDelete && (
                <button
                    aria-label="Delete task"
                    onClick={(e) => {
                        e.stopPropagation();
                        deleteTask(task.id);
                    }}
                    className="stroke-gray-500 hover:stroke-white hover:bg-red-500 absolute right-4 top-1/2 -translate-y-1/2 bg-blue-200 p-2 rounded opacity-60 hover:opacity-100"
                >
                    <img src="/trash.gif" alt="delete" width={20} />
                </button>
            )}
        </div>
    )
}

export default TaskCard
