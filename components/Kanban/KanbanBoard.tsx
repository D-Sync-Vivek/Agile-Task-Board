"use client"
import { useKanbanStore } from "@/store/useKanbanStore"
import { SortableContext } from "@dnd-kit/sortable";
import ColumnContainer from "./ColumnContainer";
import { arrayMove } from "@dnd-kit/sortable";
import { useState } from "react";
import {
    DndContext,
    DragEndEvent,
    DragOverEvent,
    useSensor,
    useSensors,
    PointerSensor,
} from "@dnd-kit/core";

const KanbanBoard = () => {
    const columns = useKanbanStore((state) => state.columns)
    const addColumn = useKanbanStore((state) => state.addColumn)
    const columnsIDs = columns.map((column) => column.id)
    const setColumns = useKanbanStore((state) => state.setColumns)
    const setTasks = useKanbanStore((state) => state.setTasks);

    const sensors = useSensors(
        useSensor(PointerSensor, {
            activationConstraint: {
                distance: 3, // Start dragging only after moving 3px
            },
        })
    );

    function callAddColumn() {
        addColumn(`Column ${columns.length + 1}`);
    }

    function onDragEnd(event: DragEndEvent) {
        const { active, over } = event;
        if (!over) return;
        if (active.id === over.id) return;

        const oldIndex = columns.findIndex((col) => col.id === active.id)
        const newIndex = columns.findIndex((col) => col.id === over.id);
        setColumns(arrayMove(columns, oldIndex, newIndex));
    }

    function onDragOver(event: DragEndEvent) {
        const { active, over } = event;
        if (!over) return;

        const activeId = active.id
        const overId = over.id

        if (activeId === overId) return;

        const isActiveTask = active.data.current?.type === "Task";
        const isOverTask = over.data.current?.type === "Task";

        if (!isActiveTask) return;

        //Read Live State to avoid closure staleness
        const tasks = useKanbanStore.getState().tasks;

        // 1. Dropping a Task over another Task.
        if (isActiveTask && isOverTask) {
            const activeIndex = tasks.findIndex((t) => t.id === activeId);
            const overIndex = tasks.findIndex((t) => t.id === overId);

            if (tasks[activeIndex].columnId !== tasks[overIndex].columnId) {
                tasks[activeIndex].columnId = tasks[overIndex].columnId;
                return setTasks(arrayMove(tasks, activeIndex, overIndex - 1))
            }
            return setTasks(arrayMove(tasks, activeIndex, overIndex));
        }

        const isOverColumn = over.data.current?.type === "Column";

        // 2. Dropping a Task over a Column.
        if (isActiveTask && isOverColumn) {
            const activeIndex = tasks.findIndex((t) => t.id === activeId);

            if (tasks[activeIndex].columnId !== overId) {
                tasks[activeIndex].columnId = overId;
                return setTasks(arrayMove(tasks, activeIndex, activeIndex))
            }
        }

    }
    return (
        <div className="m-auto flex mt-5 min-h-screen w-full items-start overflow-x-auto overflow-y-hidden px-10">
            <DndContext
                sensors={sensors}
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
            </DndContext>

            <button 
                className="border px-2 p-1 rounded-md ml-5" 
                onClick={callAddColumn}
            >
                + Add Column
            </button>
        </div>
    )
}

export default KanbanBoard
