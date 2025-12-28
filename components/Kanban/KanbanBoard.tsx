"use client"
import { useKanbanStore } from "@/store/useKanbanStore"
import { DndContext } from "@dnd-kit/core";
import { SortableContext } from "@dnd-kit/sortable";
import ColumnContainer from "./ColumnContainer";

const KanbanBoard = () => {
    const columns = useKanbanStore((state) => state.columns)
    const addColumn = useKanbanStore((state) => state.addColumn);
    
    function callAddColumn() {
        addColumn(`Hey there`);
    }
    return (
        <div className="m-auto flex min-h-screen w-full items-center overflow-x-auto overflow-y-hidden px-10">
            <div className="flex gap-4">
                {columns.map((column) => (
                    <ColumnContainer key={column.id} column={column}/>
                ))}
                <button onClick={callAddColumn}>Add Column</button>
            </div>
        </div>
    )
}

export default KanbanBoard
