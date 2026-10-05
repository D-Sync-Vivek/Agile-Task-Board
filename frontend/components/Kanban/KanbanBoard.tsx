"use client"
import { useBoardStore } from "@/store/useBoardStore"
import { useCan } from "@/hooks/useCan"
import { SortableContext } from "@dnd-kit/sortable";
import { DndContext, DragOverlay } from "@dnd-kit/core";
import { createPortal } from "react-dom";
import { useKanbanDnD } from "@/hooks/useKanbanDnD";
import { useIsMounted } from "@/hooks/useIsMounted";
import ColumnContainer from "./ColumnContainer";
import TaskCard from "./TaskCard";
import BoardGuide from "./BoardGuide";

const KanbanBoard = () => {
    const columns = useBoardStore((state) => state.columns)
    const addColumn = useBoardStore((state) => state.addColumn)
    const addingColumn = useBoardStore((state) => state.addingColumn)
    const canAddColumn = useCan("column:create")
    const columnsIDs = columns.map((column) => column.id)
    const {
        sensors,
        onDragStart,
        onDragEnd,
        onDragOver,
        onDragCancel,
        activeColumn,
        activeTask,
    } = useKanbanDnD();
    const isMounted = useIsMounted()

    function callAddColumn() {
        addColumn(); // the store names it "Column N"
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
                onDragCancel={onDragCancel}
            >
                <div className="flex gap-4">
                    <SortableContext items={columnsIDs}>
                        {columns.map((column) => (
                            <ColumnContainer key={column.id} column={column} />
                        ))}
                    </SortableContext>

                    {columns.length === 0 && (
                        <p className="mt-10 w-full text-center text-gray-400">
                            No columns yet.{canAddColumn ? " Click + to create your first column." : ""}
                        </p>
                    )}

                    {canAddColumn && (
                        <div className="fixed bottom-3 left-1/2 -translate-x-1/2">
                            <button
                                aria-label="Add column"
                                disabled={addingColumn}
                                className="px-4 py-3 cursor-pointer rounded-lg bg-gray-900 hover:bg-gray-800 border-2 border-gray-800 ring-rose-500 hover:ring-2 text-white hover:scale-105 font-bold shadow-xl disabled:cursor-wait disabled:opacity-60"
                                onClick={callAddColumn}
                            >
                                +
                            </button>
                        </div>
                    )}
                </div>
                {dragOverlayContent}
            </DndContext>
            <BoardGuide />
        </div>
    )
}

export default KanbanBoard
