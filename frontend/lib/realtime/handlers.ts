import { ROLE_LABEL } from "@/lib/memberRoles";
import { useAuthStore } from "@/store/useAuthStore";
import { useBoardActivityStore, useTaskActivityStore } from "@/store/useActivityStores";
import { useBoardStore } from "@/store/useBoardStore";
import { useCommentStore } from "@/store/useCommentStore";
import { useTaskPanelStore } from "@/store/useTaskPanelStore";
import { toast } from "@/store/useToastStore";
import type { BoardSocket } from "./socket";

export interface BoardRealtimeCallbacks {
  /** This user was removed from the board: they can no longer see it. */
  onRemovedFromBoard: () => void;
  /** The board no longer exists. */
  onBoardDeleted: () => void;
}

const board = () => useBoardStore.getState();
const myId = () => useAuthStore.getState().user?.id;

/** "Mia", or "Someone" if the actor isn't (any longer) on the member list. */
function who(actorId: string): string {
  return board().board?.members.find((m) => m.userId === actorId)?.user.name ?? "Someone";
}

/**
 * Connects every server event to the stores. Each handler is a thin translation: the stores own the rules
 * (idempotency, not disturbing a drag in progress), so applying an event twice or after a re-fetch is harmless.
 * Returns nothing to undo: the caller closes the socket, which removes all listeners at once.
 */
export function registerBoardHandlers(socket: BoardSocket, callbacks: BoardRealtimeCallbacks): void {
  // ---- tasks
  socket.on("task:created", ({ task }) => board().applyRemote({ type: "task-created", task }));
  socket.on("task:updated", ({ task }) => board().applyRemote({ type: "task-edited", task }));
  socket.on("task:moved", ({ task, columns }) => board().applyRemote({ type: "task-moved", task, columns }));
  socket.on("task:deleted", ({ taskId, actorId }) => {
    // The open panel closes itself when its task disappears; say why, so it doesn't look like a glitch.
    if (useTaskPanelStore.getState().taskId === taskId) toast.info(`${who(actorId)} deleted this task.`);
    board().applyRemote({ type: "task-deleted", taskId });
  });

  // ---- columns
  socket.on("column:created", ({ column }) => board().applyRemote({ type: "column-created", column }));
  socket.on("column:updated", ({ column }) => board().applyRemote({ type: "column-renamed", column }));
  socket.on("column:deleted", ({ columnId }) => board().applyRemote({ type: "column-deleted", columnId }));
  socket.on("column:reordered", ({ columns }) => board().applyRemote({ type: "columns-reordered", columns }));

  // ---- comments (only matter while that task's panel is open; the store ignores the rest)
  socket.on("comment:created", ({ comment }) => useCommentStore.getState().receive({ type: "created", comment }));
  socket.on("comment:updated", ({ comment }) => useCommentStore.getState().receive({ type: "updated", comment }));
  socket.on("comment:deleted", ({ commentId, taskId }) => useCommentStore.getState().receive({ type: "deleted", commentId, taskId }));

  // ---- members
  socket.on("member:added", ({ member }) => board().applyRemote({ type: "member-added", member }));
  socket.on("member:updated", ({ member }) => {
    board().applyRemote({ type: "member-changed", member });
    if (member.userId === myId()) {
      // Our own role changed: what we may do changed with it, and only the server knows the exact permissions.
      toast.info(`Your role on this board is now ${ROLE_LABEL[member.role]}.`);
      const boardId = board().board?.id;
      if (boardId) void board().loadBoard(boardId, { silent: true });
    }
  });
  socket.on("member:removed", ({ memberId, userId }) => {
    if (userId === myId()) return callbacks.onRemovedFromBoard();
    board().applyRemote({ type: "member-removed", userId, memberId });
  });

  // ---- the board itself
  socket.on("board:updated", ({ board: changes }) => board().applyRemote({ type: "board-edited", name: changes.name, description: changes.description }));
  socket.on("board:deleted", () => callbacks.onBoardDeleted());

  // ---- activity feeds (whichever are open)
  socket.on("activity:created", ({ activity }) => {
    useBoardActivityStore.getState().receive(activity);
    useTaskActivityStore.getState().receive(activity);
  });
}

/** After a (re)connect, events may have been missed: re-read everything that is on screen. */
export function resyncAfterReconnect(boardId: string): void {
  void board().loadBoard(boardId, { silent: true });
  void useBoardActivityStore.getState().refresh();
  void useTaskActivityStore.getState().refresh();
  void useCommentStore.getState().refresh();
}
