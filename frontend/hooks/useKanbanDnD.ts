import { useBoardStore } from "@/store/useBoardStore";
import { arrayMove } from "@dnd-kit/sortable";
import { useState } from "react";
import {
  DragEndEvent,
  useSensor,
  useSensors,
  PointerSensor,
  DragStartEvent,
  TouchSensor,
  KeyboardSensor,
} from "@dnd-kit/core";
import { Column, Task } from "@/types";
import { sortableKeyboardCoordinates } from "@dnd-kit/sortable";

export function useKanbanDnD() {
  const columns = useBoardStore((state) => state.columns);
  const setColumns = useBoardStore((state) => state.setColumns);
  const setTasks = useBoardStore((state) => state.setTasks);
  const beginDrag = useBoardStore((state) => state.beginDrag);
  const cancelDrag = useBoardStore((state) => state.cancelDrag);
  const endDragTask = useBoardStore((state) => state.endDragTask);
  const endDragColumn = useBoardStore((state) => state.endDragColumn);
  const [activeColumn, setActiveColumn] = useState<Column | null>(null);
  const [activeTask, setActiveTask] = useState<Task | null>(null);

  const sensors = useSensors(
    // Mouse/TrackPad: Moving 10px to start
    useSensor(PointerSensor, {
      activationConstraint: {
        distance: 10, // Start dragging only after moving 3px
      },
    }),

    // Mobile/Touch: Holding for 250ms to start
    useSensor(TouchSensor, {
      activationConstraint: {
        delay: 250,  // press and hold.
        tolerance: 5,
      },
    }),

    // Keyboard for accessibility
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates
    })
  );

  // On Drag Start
  function onDragStart(event: DragStartEvent) {
    beginDrag(); // snapshot for rollback / cancel
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
    const activeType = active.data.current?.type;

    // A dragged task has already been moved (live) by onDragOver; what is on screen now is what we save.
    // This must happen before any early return: dropping a task on itself or outside any target still counts.
    if (activeType === "Task") {
      void endDragTask(String(active.id));
      return;
    }

    if (activeType === "Column") {
      if (over && active.id !== over.id) {
        // Over another column, or over a task inside one (then use that task's column).
        const overColumnId =
          over.data.current?.type === "Task"
            ? useBoardStore.getState().tasks.find((t) => t.id === over.id)?.columnId
            : String(over.id);
        const oldIndex = columns.findIndex((col) => col.id === active.id);
        const newIndex = columns.findIndex((col) => col.id === overColumnId);
        if (oldIndex !== -1 && newIndex !== -1) {
          setColumns(arrayMove(columns, oldIndex, newIndex));
        }
      }
      void endDragColumn();
      return;
    }

    cancelDrag(); // unknown item type: leave nothing half-done
  }

  // On Drag Cancel (Escape): put everything back; nothing is sent to the server.
  function onDragCancel() {
    setActiveColumn(null);
    setActiveTask(null);
    cancelDrag();
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
    const tasks = useBoardStore.getState().tasks;

    // 1. Dropping a Task over another Task.
    if (isActiveTask && isOverTask) {
      const activeIndex = tasks.findIndex((t) => t.id === activeId);
      const overIndex = tasks.findIndex((t) => t.id === overId);

      if (tasks[activeIndex].columnId !== tasks[overIndex].columnId) {
        // New object instead of editing the old one in place (the rollback snapshot depends on that).
        const moved = { ...tasks[activeIndex], columnId: tasks[overIndex].columnId };
        const next = tasks.map((t, i) => (i === activeIndex ? moved : t));
        return setTasks(arrayMove(next, activeIndex, overIndex - 1));
      }
      return setTasks(arrayMove(tasks, activeIndex, overIndex));
    }

    const isOverColumn = over.data.current?.type === "Column";

    // 2. Dropping a Task over a Column.
    if (isActiveTask && isOverColumn) {
      const activeIndex = tasks.findIndex((t) => t.id === activeId);

      if (tasks[activeIndex].columnId !== overId) {
        const next = tasks.map((t, i) => (i === activeIndex ? { ...t, columnId: String(overId) } : t));
        return setTasks(arrayMove(next, activeIndex, activeIndex));
      }
    }
  }

  return {
    sensors,
    onDragStart,
    onDragOver,
    onDragEnd,
    onDragCancel,
    activeColumn,
    activeTask,
  };
}
