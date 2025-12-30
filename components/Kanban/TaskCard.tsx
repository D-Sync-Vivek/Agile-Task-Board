import { Task, Id } from "@/types"
import { useSortable } from "@dnd-kit/sortable"
import { CSS } from "@dnd-kit/utilities"
import { useKanbanStore } from "@/store/useKanbanStore"

interface Props {
    task: Task;
}

const TaskCard = ({ task }: Props) => {
    const deleteTask = useKanbanStore((state) => state.deleteTask);

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
        }
    })

    const style = {
        transition,
        transform: CSS.Transform.toString(transform)
    }

    if(isDragging){
        return (
            <div
            ref={setNodeRef}
            style={style}
            className="opacity-30 bg-gray-50 p-2.5 h-25 min-h-25 items-center flex text-left rounded-xl border-2 border-rose-500 cursor-grab relative"
            />
        )
    }

    return (
        <div
        ref={setNodeRef}
        style={style}
        {...attributes}
        {...listeners}
        className="bg-white p-2.5 h-25 min-h-25 items-center flex text-left rounded-xl hover:ring-2 hover:ring-inset hover:ring-rose-500 cursor-grab relative task"
        >
            <p className="my-auto h-[90%] w-full overflow-y-auto overflow-x-hidden whitespace-pre-wrap">
                {task.content}
            </p>
        {/* Delete Button */}
        <button
        onClick={() => deleteTask(task.id)}
        className="stroke-gray-500 hover:stroke-white hover:bg-columnBackgroundColor absolute right-4 top-1/2 -translate-y-1/2 bg-columnBackgroundColor p-2 rounded opacity-60 hover:opacity-100"
        >
            🗑️
        </button>
        </div>
    )
}

export default TaskCard
