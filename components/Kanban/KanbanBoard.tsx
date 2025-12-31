"use client"
import { useKanbanStore } from "@/store/useKanbanStore"
import { SortableContext } from "@dnd-kit/sortable";
import { DndContext, DragOverlay } from "@dnd-kit/core";
import { createPortal } from "react-dom";
import { usekanbanDnD } from "@/hooks/useKanbanDnD";
import { useEffect, useState } from "react";
import ColumnContainer from "./ColumnContainer";
import TaskCard from "./TaskCard";
import BoardGuide from "./BoardGuide";

const KanbanBoard = () => {
    const columns = useKanbanStore((state) => state.columns)
    const addColumn = useKanbanStore((state) => state.addColumn)
    const columnsIDs = columns.map((column) => column.id)
    const {
        sensors,
        onDragStart,
        onDragEnd,
        onDragOver,
        activeColumn,
        activeTask,
    } = usekanbanDnD();
    const [isMounted, setIsMounted] = useState(false)

    useEffect(() => {
        setIsMounted(true)
    }, [])

    function callAddColumn() {
        addColumn(`Column ${columns.length + 1}`);
    }

    const dragOverlayContent = isMounted ? createPortal(
        <DragOverlay>
            {activeColumn && (
                <ColumnContainer column={activeColumn} />
            )}
            {activeTask && (
                <TaskCard task={activeTask} />
            )}
        </DragOverlay>,
        document.body
    ) : null;
    
    return (
        <div className="m-auto flex p-2 md:p-10 min-h-screen w-full items-start overflow-x-auto overflow-y-hidden">
            <DndContext
                sensors={sensors}
                onDragStart={onDragStart}
                onDragEnd={onDragEnd}
                onDragOver={onDragOver}
            >
                <div className="flex gap-4">
                    <SortableContext items={columnsIDs}>
                        {columns.map((column) => (
                            <ColumnContainer key={column.id} column={column} />
                        ))}
                    </SortableContext>
                </div>
                {dragOverlayContent}
            </DndContext>

            <button
                className="absolute bottom-20 right-[45vw] border min-w-35 px-2 p-1 rounded-md ml-5 hover:bg-gray-400 hover:scale-105"
                onClick={callAddColumn}
            >
                + Add Column
            </button>
            <BoardGuide/>
            <p className="absolute bottom-0 text-gray-500 flex items-center justify-center w-[97vw]">Press "i" or "I" to toggle the instructions</p>
        </div>
    )
}

export default KanbanBoard
