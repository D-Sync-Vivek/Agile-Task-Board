"use client"
import { useKanbanStore } from "@/store/useKanbanStore"
import { DndContext } from "@dnd-kit/core";
import { SortableContext } from "@dnd-kit/sortable";
import ColumnContainer from "./ColumnContainer";
import { DragEndEvent } from "@dnd-kit/core";
import { arrayMove } from "@dnd-kit/sortable";
import { useState } from "react";

const KanbanBoard = () => {
    const columns = useKanbanStore((state) => state.columns)
    const addColumn = useKanbanStore((state) => state.addColumn)
    const columnsIDs = columns.map((column) => column.id)
    const setColumns = useKanbanStore((state) => state.setColumns)
    const [count, setCount] = useState(1)

    function callAddColumn() {
        addColumn(`Hey there ${count}`);
        setCount((count => count + 1))
    }

    function onDragEnd(event: DragEndEvent) {
        const {active, over} = event;
        if(!over) return ;
        if(active.id === over.id) return;

        const oldIndex = columns.findIndex((col) => col.id === active.id)
        const newIndex = columns.findIndex((col) => col.id === over.id);
        setColumns(arrayMove(columns, oldIndex, newIndex));
    }
    return (
        <div className="m-auto flex mt-5 min-h-screen w-full items-start overflow-x-auto overflow-y-hidden px-10">
            <div className="flex gap-4">
                <DndContext onDragEnd={onDragEnd}>
                    <SortableContext items={columnsIDs}>
                        {columns.map((column) => (
                            <ColumnContainer key={column.id} column={column} />
                        ))}
                    </SortableContext>
                </DndContext>
                <button className="border px-2 p-1 rounded-md" onClick={callAddColumn}>Add Column</button>
            </div>
        </div>
    )
}

export default KanbanBoard
