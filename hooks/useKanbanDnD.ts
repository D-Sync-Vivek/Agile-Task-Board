import { useKanbanStore } from "@/store/useKanbanStore";
import { arrayMove } from "@dnd-kit/sortable";
import { useState } from "react";
import {
  DragEndEvent,
  useSensor,
  useSensors,
  PointerSensor,
  DragStartEvent,
} from "@dnd-kit/core";
import { Column, Task } from "@/types";

export function usekanbanDnD() {
  const columns = useKanbanStore((state) => state.columns);
  const addColumn = useKanbanStore((state) => state.addColumn);
  const columnsIDs = columns.map((column) => column.id);
  const setColumns = useKanbanStore((state) => state.setColumns);
  const setTasks = useKanbanStore((state) => state.setTasks);
  const [activeColumn, setActiveColumn] = useState<Column | null>(null);
  const [activeTask, setActiveTask] = useState<Task | null>(null);

  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: {
        distance: 3, // Start dragging only after moving 3px
      },
    })
  );

  // On Drag Start
  function onDragStart(event: DragStartEvent) {
    if (event.active.data.current?.type === "Column") {
      setActiveColumn(event.active.data.current.column);
      return;
    }
    if (event.active.data.current?.type === "Task") {
      setActiveTask(event.active.data.current.task);
      return;
    }
  }

  //   On Drag End
  function onDragEnd(event: DragEndEvent) {
    setActiveColumn(null);
    setActiveTask(null);
    const { active, over } = event;
    if (!over) return;
    if (active.id === over.id) return;

    const oldIndex = columns.findIndex((col) => col.id === active.id);
    const newIndex = columns.findIndex((col) => col.id === over.id);
    setColumns(arrayMove(columns, oldIndex, newIndex));
  }

  // On Drag Over
  function onDragOver(event: DragEndEvent) {
    const { active, over } = event;
    if (!over) return;

    const activeId = active.id;
    const overId = over.id;

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
        return setTasks(arrayMove(tasks, activeIndex, overIndex - 1));
      }
      return setTasks(arrayMove(tasks, activeIndex, overIndex));
    }

    const isOverColumn = over.data.current?.type === "Column";

    // 2. Dropping a Task over a Column.
    if (isActiveTask && isOverColumn) {
      const activeIndex = tasks.findIndex((t) => t.id === activeId);

      if (tasks[activeIndex].columnId !== overId) {
        tasks[activeIndex].columnId = overId;
        return setTasks(arrayMove(tasks, activeIndex, activeIndex));
      }
    }
  }

  return {
    sensors,
    onDragStart,
    onDragOver,
    onDragEnd,
    activeColumn,
    activeTask,
  };
}
