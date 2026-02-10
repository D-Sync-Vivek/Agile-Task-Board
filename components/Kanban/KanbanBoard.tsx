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
        <div className="relative m-auto flex p-2 md:p-10 w-full items-start overflow-x-auto overflow-y-hidden">
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

                    <div className="fixed bottom-3 flex justify-center items-cente w-[95vw] mx-auto">
                        <button className="px-4 py-3 cursor-pointer rounded-lg bg-(--main-bg-color) hover:bg-[#1a64d4]  border-2 border-(--column-bg-color) ring-rose-500 hover:ring-2 flex justify-center gap-2 snap-center text-white  hover:scale-105 font-bold"
                            onClick={callAddColumn}
                        >
                            +
                        </button>
                    </div>
                </div>
                {dragOverlayContent}
            </DndContext>
            <BoardGuide />
        </div>
    )
}

export default KanbanBoard
