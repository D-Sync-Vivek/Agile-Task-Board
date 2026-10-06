import { Task } from "@/types"
import { useSortable } from "@dnd-kit/sortable"
import { CSS } from "@dnd-kit/utilities"
import { useBoardStore } from "@/store/useBoardStore"
import { useCan } from "@/hooks/useCan"
import { useTaskPanelStore } from "@/store/useTaskPanelStore"

interface Props {
    task: Task;
}

const TaskCard = ({ task }: Props) => {
    const deleteTask = useBoardStore((state) => state.deleteTask);
    const openPanel = useTaskPanelStore((state) => state.open);
    const canMove = useCan("task:move");
    const canDelete = useCan("task:delete");

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
        disabled: !canMove
    })

    const style = {
        transition,
        transform: CSS.Transform.toString(transform)
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
            onClick={() => openPanel(task.id)} // dnd-kit swallows the click that follows a real drag
            className="bg-gray-800 p-2.5 h-25 min-h-25 items-center flex text-left rounded-xl hover:ring-2 hover:ring-inset hover:ring-rose-500 cursor-grab relative task text-gray-100 shadow-sm"
        >
            <p className="my-auto h-[90%] w-[80%] overflow-y-auto overflow-x-hidden whitespace-pre-wrap">{task.title}</p>

            {/* Keyboard route to the details: Enter/Space on the card itself start a keyboard drag (dnd-kit). */}
            <button
                aria-label={`Open details for ${task.title}`}
                onClick={(e) => {
                    e.stopPropagation();
                    openPanel(task.id);
                }}
                onKeyDown={(e) => e.stopPropagation()} // otherwise Enter/Space would start a keyboard drag instead of clicking
                className="sr-only focus-visible:not-sr-only focus-visible:absolute focus-visible:left-2 focus-visible:top-1 rounded bg-rose-600 px-2 py-0.5 text-xs text-white"
            >
                Details
            </button>

            {canDelete && (
                <button
                    aria-label="Delete task"
                    onClick={(e) => {
                        e.stopPropagation();
                        deleteTask(task.id);
                    }}
                    onKeyDown={(e) => e.stopPropagation()}
                    className="stroke-gray-500 hover:stroke-white hover:bg-red-500 absolute right-4 top-1/2 -translate-y-1/2 bg-blue-200 p-2 rounded opacity-60 hover:opacity-100"
                >
                    <img src="/trash.gif" alt="delete" width={20} />
                </button>
            )}
        </div>
    )
}

export default TaskCard
