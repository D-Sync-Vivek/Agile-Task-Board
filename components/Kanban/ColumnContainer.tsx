"use client"
import { Column } from "@/types"
import { useKanbanStore } from "@/store/useKanbanStore"
import { useSortable } from "@dnd-kit/sortable"
import { CSS } from "@dnd-kit/utilities"

const ColumnContainer = ({ column }: { column: Column }) => {

    const deleteColumn = useKanbanStore((state) => state.deleteColumn)
    const tasks = useKanbanStore((state) => state.tasks)

    const { setNodeRef, attributes, listeners, transform, transition, isDragging } = useSortable({
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

    function callDeleteColumn() {
        const id = column.id
        deleteColumn(id)
    }
    return (
        <>
            <div className="bg-gray-100 flex p-2" ref={setNodeRef} style={style}>
                <div className={`w-87.5 ${isDragging === true ? "border-2 border-rose-500 opacity-50" : ""}`}   {...attributes} {...listeners}>
                <span className="">{column.title}</span>
                {tasks.filter(task => task.columnId === column.id).map((task) => (
                    <p key={task.id}>{task.content}</p>
                ))}
            </div>
            <span className="flex items-center" onClick={callDeleteColumn}>🗑️</span>
            </div>
        </>
    )
}

export default ColumnContainer
