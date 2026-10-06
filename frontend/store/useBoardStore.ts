import { create } from "zustand";
import { api } from "@/lib/api";
import { reconcileColumns, reconcileTasks, restoreColumnOrder, restoreTaskPlacement, sameLocation, taskLocation } from "@/lib/boardLayout";
import { getErrorMessage, isApiError } from "@/lib/errors";
import { useAuthStore } from "@/store/useAuthStore";
import { toast } from "@/store/useToastStore";
import type { Column, Id, Task } from "@/types";
import type { BoardDetail, TaskPriority } from "@/types/api";

/**
 * Client-side cache of ONE board. PostgreSQL (through the API) is the source of truth; nothing here is persisted.
 *
 * How writes behave:
 *  - Creating a column/task waits for the server (it needs the server-generated id; optimistic creates would need
 *    temporary ids that later requests could mistakenly use).
 *  - Renames, edits and deletes are OPTIMISTIC: the UI changes immediately, the request follows, and on failure the
 *    change is rolled back and a toast explains why.
 *  - If the failure says our view is stale (403/404/409) the board is quietly re-fetched.
 */

export type BoardStatus = "idle" | "loading" | "ready" | "error";

export type BoardMeta = Pick<BoardDetail, "id" | "name" | "description" | "ownerId" | "myRole" | "myPermissions" | "members">;

export interface TaskDetailsChanges {
  title?: string;
  description?: string | null;
  priority?: TaskPriority;
  dueDate?: string | null;
  assigneeId?: string | null;
}

export interface BoardLoadError {
  status: number;
  code: string;
  message: string;
}

interface BoardState {
  board: BoardMeta | null;
  columns: Column[];
  tasks: Task[];
  status: BoardStatus;
  error: BoardLoadError | null;
  addingColumn: boolean;
  addingTaskIn: Id[]; // columns with a create-task request in flight

  loadBoard: (boardId: string, options?: { signal?: AbortSignal; silent?: boolean }) => Promise<void>;
  reset: () => void;

  addColumn: (title?: string) => Promise<void>;
  renameColumn: (id: Id, title: string) => Promise<void>;
  deleteColumn: (id: Id) => Promise<void>;

  addTask: (columnId: Id, title?: string) => Promise<void>;
  /**
   * Saves edits from the task detail form. Server-confirmed (the form needs the server's validation messages), and
   * it throws the ApiError so the form can show them. Content fields and the assignee are separate endpoints, so
   * they are saved in turn; if the second fails the first stays applied.
   */
  updateTaskDetails: (id: Id, changes: TaskDetailsChanges) => Promise<void>;
  deleteTask: (id: Id) => Promise<void>;

  /**
   * Drag-and-drop session. While dragging, the hook rearranges the board locally (setColumns/setTasks) for live
   * feedback; the server is told once, when the drag ends. Every UI change is optimistic and rolled back on failure.
   */
  beginDrag: () => void;
  cancelDrag: () => void; // Escape: put everything back, no request
  endDragTask: (taskId: Id) => Promise<void>; // persist the task's final column + position
  endDragColumn: () => Promise<void>; // persist the final column order

  /** Local-only setters used by the drag-and-drop hook for the live preview. */
  setColumns: (columns: Column[]) => void;
  setTasks: (tasks: Task[]) => void;
}

const initial = {
  board: null,
  columns: [],
  tasks: [],
  status: "idle" as BoardStatus,
  error: null,
  addingColumn: false,
  addingTaskIn: [] as Id[],
};

// Incremented by every load/reset so a slow response for an old request or an old board is ignored.
let loadSeq = 0;

// Drag-and-drop bookkeeping (module-level: it is transient, never rendered).
interface DragSnapshot {
  boardId: string;
  columns: Column[];
  tasks: Task[];
}
let dragSnapshot: DragSnapshot | null = null; // deep copy taken when a drag starts (the store's objects are replaced, never mutated)
let dragging = false;
let layoutSeq = 0; // numbers each persisted layout change; only the newest may reconcile or roll back
let pendingLayoutWrites = 0;
let needsResync = false;

const DEFAULT_TASK_TITLE = "Double Click to edit";

/** Reports a failed write: a toast (or a silent session reset on 401). */
function reportFailure(error: unknown, fallback: string) {
  if (isApiError(error, 401)) {
    useAuthStore.getState().markAnonymous(); // the page guard sends the user to /login
    return;
  }
  toast.error(getErrorMessage(error, fallback));
}

const isStale = (error: unknown) => isApiError(error, 403) || isApiError(error, 404) || isApiError(error, 409);

export const useBoardStore = create<BoardState>((set, get) => {
  const sameBoard = (boardId: string) => get().board?.id === boardId;
  const resyncIfStale = (error: unknown, boardId: string) => {
    if (isStale(error) && sameBoard(boardId)) void get().loadBoard(boardId, { silent: true });
  };

  /** Re-fetches the board once nothing is in flight and nobody is mid-drag (so we never yank cards from under the cursor). */
  const flushResync = (boardId: string) => {
    if (needsResync && pendingLayoutWrites === 0 && !dragging && sameBoard(boardId)) {
      needsResync = false;
      void get().loadBoard(boardId, { silent: true });
    }
  };

  const takeSnapshot = (): DragSnapshot | null => {
    const snapshot = dragSnapshot;
    dragSnapshot = null;
    dragging = false;
    return snapshot;
  };

  /**
   * Sends one layout change to the server. The UI has ALREADY changed (optimistic), so:
   *  - success: apply the server's canonical order, but only if this is still the newest change and the user isn't
   *    dragging again (an older response must not undo a newer move);
   *  - failure: roll back (again only if it is still the newest change), tell the user, and re-sync with the server
   *    when it says our view was stale (403/404/409) or when an older failure couldn't be rolled back precisely.
   */
  const persistLayout = async <T,>(options: { boardId: string; request: () => Promise<T>; apply: (result: T) => void; rollback: () => void; failure: string }) => {
    const { boardId } = options;
    const seq = ++layoutSeq;
    pendingLayoutWrites++;
    try {
      const result = await options.request();
      if (sameBoard(boardId) && seq === layoutSeq && !dragging) options.apply(result);
    } catch (error) {
      if (sameBoard(boardId)) {
        if (seq === layoutSeq) options.rollback();
        else needsResync = true;
        if (isStale(error)) needsResync = true;
        reportFailure(error, options.failure);
      }
    } finally {
      pendingLayoutWrites--;
      flushResync(boardId);
    }
  };

  return {
    ...initial,

    loadBoard: async (boardId, { signal, silent = false } = {}) => {
      const seq = ++loadSeq;
      const showingThisBoard = sameBoard(boardId);
      if (!silent || !showingThisBoard) {
        if (!showingThisBoard) {
          dragSnapshot = null;
          dragging = false;
        }
        set({ ...(showingThisBoard ? {} : { board: null, columns: [], tasks: [], addingColumn: false, addingTaskIn: [] }), status: "loading", error: null });
      }
      try {
        const { board } = await api.boards.get(boardId, { signal });
        if (seq !== loadSeq || signal?.aborted) return;
        const { columns, tasks, ...meta } = board;
        set({ board: meta, columns, tasks, status: "ready", error: null });
      } catch (error) {
        if (seq !== loadSeq || signal?.aborted) return;
        if (isApiError(error, 401)) useAuthStore.getState().markAnonymous();
        // A background refresh that fails (e.g. offline) must not blow away a board the user is looking at,
        // unless the board is really gone / no longer accessible.
        if (silent && showingThisBoard && !isApiError(error, 404) && !isApiError(error, 403)) return;
        const apiError = isApiError(error) ? error : undefined;
        set({
          status: "error",
          error: {
            status: apiError?.status ?? 0,
            code: apiError?.code ?? "UNKNOWN_ERROR",
            message: getErrorMessage(error, "Unable to load this board."),
          },
        });
      }
    },

    reset: () => {
      loadSeq++;
      layoutSeq++;
      dragSnapshot = null;
      dragging = false;
      needsResync = false;
      set({ ...initial });
    },

    // ---------------------------------------------------------------- columns
    addColumn: async (title) => {
      const { board, addingColumn, columns } = get();
      if (!board || addingColumn) return;
      set({ addingColumn: true });
      try {
        const { column } = await api.columns.create(board.id, { title: title ?? `Column ${columns.length + 1}` });
        if (sameBoard(board.id)) set((s) => ({ columns: [...s.columns, column] }));
      } catch (error) {
        reportFailure(error, "Couldn't add the column.");
      } finally {
        set({ addingColumn: false });
      }
    },

    renameColumn: async (id, rawTitle) => {
      const board = get().board;
      const title = rawTitle.trim();
      const previous = get().columns.find((c) => c.id === id);
      if (!board || !previous || !title || previous.title === title) return; // blank/unchanged = no-op

      set((s) => ({ columns: s.columns.map((c) => (c.id === id ? { ...c, title } : c)) }));
      try {
        const { column } = await api.columns.rename(id, { title });
        set((s) => ({ columns: s.columns.map((c) => (c.id === id ? { ...c, title: column.title, updatedAt: column.updatedAt } : c)) }));
      } catch (error) {
        // Roll back only if nobody has changed the title again since our optimistic edit.
        set((s) => ({ columns: s.columns.map((c) => (c.id === id && c.title === title ? { ...c, title: previous.title } : c)) }));
        reportFailure(error, "Couldn't rename the column.");
        resyncIfStale(error, board.id);
      }
    },

    deleteColumn: async (id) => {
      const board = get().board;
      const index = get().columns.findIndex((c) => c.id === id);
      if (!board || index < 0) return;
      const removedColumn = get().columns[index];
      const removedTasks = get().tasks.filter((t) => t.columnId === id);

      set((s) => ({ columns: s.columns.filter((c) => c.id !== id), tasks: s.tasks.filter((t) => t.columnId !== id) }));
      try {
        await api.columns.delete(id);
      } catch (error) {
        if (isApiError(error, 404)) return; // already deleted elsewhere: the UI state is right
        set((s) =>
          s.columns.some((c) => c.id === id)
            ? s
            : {
                columns: [...s.columns.slice(0, index), removedColumn, ...s.columns.slice(index)],
                tasks: [...s.tasks, ...removedTasks], // relative order within the column is preserved
              }
        );
        reportFailure(error, "Couldn't delete the column.");
        resyncIfStale(error, board.id);
      }
    },

    // ------------------------------------------------------------------ tasks
    addTask: async (columnId, title = DEFAULT_TASK_TITLE) => {
      const board = get().board;
      if (!board || get().addingTaskIn.includes(columnId)) return;
      set((s) => ({ addingTaskIn: [...s.addingTaskIn, columnId] }));
      try {
        const { task } = await api.tasks.create(board.id, { title, columnId });
        if (sameBoard(board.id) && get().columns.some((c) => c.id === task.columnId)) {
          set((s) => ({ tasks: [...s.tasks, task] }));
        }
      } catch (error) {
        reportFailure(error, "Couldn't add the task.");
        resyncIfStale(error, board.id);
      } finally {
        set((s) => ({ addingTaskIn: s.addingTaskIn.filter((c) => c !== columnId) }));
      }
    },

    updateTaskDetails: async (id, changes) => {
      const board = get().board;
      if (!board || !get().tasks.some((t) => t.id === id)) return;
      const { assigneeId, ...content } = changes;
      const hasContent = Object.values(content).some((v) => v !== undefined);

      try {
        if (hasContent) {
          const { task } = await api.tasks.update(id, content);
          // Take only the content fields: column/position are managed by drag and drop.
          set((s) => ({ tasks: s.tasks.map((t) => (t.id === id ? { ...t, title: task.title, description: task.description, priority: task.priority, dueDate: task.dueDate, updatedAt: task.updatedAt } : t)) }));
        }
        if (assigneeId !== undefined) {
          const { task } = await api.tasks.assign(id, assigneeId);
          set((s) => ({ tasks: s.tasks.map((t) => (t.id === id ? { ...t, assigneeId: task.assigneeId, updatedAt: task.updatedAt } : t)) }));
        }
      } catch (error) {
        if (isApiError(error, 401)) useAuthStore.getState().markAnonymous();
        resyncIfStale(error, board.id); // e.g. the task was deleted elsewhere: the panel closes itself when it vanishes
        throw error;
      }
    },

    deleteTask: async (id) => {
      const board = get().board;
      const index = get().tasks.findIndex((t) => t.id === id);
      if (!board || index < 0) return;
      const removed = get().tasks[index];

      set((s) => ({ tasks: s.tasks.filter((t) => t.id !== id) }));
      try {
        await api.tasks.delete(id);
      } catch (error) {
        if (isApiError(error, 404)) return; // already gone elsewhere
        set((s) =>
          s.tasks.some((t) => t.id === id) || !s.columns.some((c) => c.id === removed.columnId)
            ? s
            : { tasks: [...s.tasks.slice(0, index), removed, ...s.tasks.slice(index)] }
        );
        reportFailure(error, "Couldn't delete the task.");
        resyncIfStale(error, board.id);
      }
    },

    // ------------------------------------------------------------ drag and drop
    beginDrag: () => {
      const { board, columns, tasks } = get();
      if (!board) return;
      dragging = true;
      dragSnapshot = { boardId: board.id, columns: columns.map((c) => ({ ...c })), tasks: tasks.map((t) => ({ ...t })) };
    },

    cancelDrag: () => {
      const snapshot = takeSnapshot();
      if (!snapshot || !sameBoard(snapshot.boardId)) return;
      set((s) => ({
        columns: restoreColumnOrder(s.columns, snapshot.columns),
        tasks: restoreTaskPlacement(s.tasks, snapshot.tasks, new Set(s.columns.map((c) => c.id))),
      }));
      flushResync(snapshot.boardId);
    },

    endDragTask: async (taskId) => {
      const snapshot = takeSnapshot();
      const board = get().board;
      if (!snapshot || !board || snapshot.boardId !== board.id) return;

      const before = taskLocation(snapshot.tasks, taskId);
      const after = taskLocation(get().tasks, taskId);
      if (!before || !after || sameLocation(before, after)) return flushResync(board.id); // dropped where it started

      await persistLayout({
        boardId: board.id,
        request: () => api.tasks.move(taskId, { columnId: after.columnId, position: after.index }),
        apply: ({ task, columns }) => set((s) => ({ tasks: reconcileTasks(s.tasks, columns, task) })),
        rollback: () =>
          set((s) => ({ tasks: restoreTaskPlacement(s.tasks, snapshot.tasks, new Set(s.columns.map((c) => c.id))) })),
        failure: "Couldn't move the task.",
      });
    },

    endDragColumn: async () => {
      const snapshot = takeSnapshot();
      const board = get().board;
      if (!snapshot || !board || snapshot.boardId !== board.id) return;

      const beforeIds = snapshot.columns.map((c) => c.id);
      const afterIds = get().columns.map((c) => c.id);
      if (beforeIds.length === afterIds.length && beforeIds.every((id, i) => id === afterIds[i])) return flushResync(board.id);

      await persistLayout({
        boardId: board.id,
        request: () => api.columns.reorder(board.id, afterIds),
        apply: ({ columns }) => set((s) => ({ columns: reconcileColumns(s.columns, columns) })),
        rollback: () => set((s) => ({ columns: restoreColumnOrder(s.columns, snapshot.columns) })),
        failure: "Couldn't reorder the columns.",
      });
    },

    setColumns: (columns) => set({ columns }),
    setTasks: (tasks) => set({ tasks }),
  };
});
