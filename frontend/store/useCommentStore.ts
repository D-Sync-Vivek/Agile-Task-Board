import { create } from "zustand";
import { api } from "@/lib/api";
import { getErrorMessage, isApiError } from "@/lib/errors";
import { useAuthStore } from "@/store/useAuthStore";
import { useBoardStore } from "@/store/useBoardStore";
import { toast } from "@/store/useToastStore";
import type { Id } from "@/types";
import type { CommentDto } from "@/types/api";

/**
 * Comments of the ONE task whose detail panel is open (loaded when it opens, discarded when it closes).
 *
 *  - Posting is OPTIMISTIC: the comment shows up at once, marked `pending` (no edit/delete until the server has given
 *    it a real id). If the post fails it is removed and the error is thrown so the composer can restore the text.
 *  - Editing and deleting are optimistic too, with rollback + a toast, like the rest of the board.
 */

export interface CommentView extends CommentDto {
  pending?: boolean;
}

type Status = "idle" | "loading" | "ready" | "error";

interface CommentState {
  taskId: Id | null;
  comments: CommentView[];
  status: Status;
  error: string | null;

  load: (taskId: Id, options?: { signal?: AbortSignal }) => Promise<void>;
  reset: () => void;
  /** Throws on failure (after removing the pending comment) so the caller can put the text back. */
  add: (taskId: Id, content: string) => Promise<void>;
  edit: (commentId: Id, content: string) => Promise<void>;
  remove: (commentId: Id) => Promise<void>;
}

const initial = { taskId: null, comments: [] as CommentView[], status: "idle" as Status, error: null };

let loadSeq = 0;
let tempSeq = 0;

const isPending = (c: CommentView | undefined) => !c || c.pending === true;

/** After a stale-state failure (404/403) the task may be gone: let the board re-check itself. */
function resyncBoard(error: unknown) {
  if (!isApiError(error, 404) && !isApiError(error, 403)) return;
  const boardId = useBoardStore.getState().board?.id;
  if (boardId) void useBoardStore.getState().loadBoard(boardId, { silent: true });
}

function reportFailure(error: unknown, fallback: string) {
  if (isApiError(error, 401)) {
    useAuthStore.getState().markAnonymous();
    return;
  }
  toast.error(getErrorMessage(error, fallback));
}

export const useCommentStore = create<CommentState>((set, get) => ({
  ...initial,

  load: async (taskId, { signal } = {}) => {
    const seq = ++loadSeq;
    set({ ...initial, taskId, status: "loading" });
    try {
      const { comments } = await api.comments.list(taskId, { signal });
      if (seq !== loadSeq || signal?.aborted) return;
      set({ comments, status: "ready", error: null });
    } catch (error) {
      if (seq !== loadSeq || signal?.aborted) return;
      if (isApiError(error, 401)) useAuthStore.getState().markAnonymous();
      set({ status: "error", error: getErrorMessage(error, "Unable to load comments.") });
    }
  },

  reset: () => {
    loadSeq++;
    set({ ...initial });
  },

  add: async (taskId, rawContent) => {
    const content = rawContent.trim();
    const user = useAuthStore.getState().user;
    if (!content || !user || get().taskId !== taskId) return;

    const tempId = `pending-${++tempSeq}`;
    const now = new Date().toISOString();
    const pending: CommentView = {
      id: tempId, taskId, userId: user.id, content, createdAt: now, updatedAt: now, edited: false,
      author: { id: user.id, name: user.name, avatar: user.avatar }, pending: true,
    };
    set((s) => ({ comments: [...s.comments, pending] }));

    try {
      const { comment } = await api.comments.create(taskId, { content });
      if (get().taskId !== taskId) return; // the panel moved on
      set((s) => ({ comments: s.comments.map((c) => (c.id === tempId ? comment : c)) }));
    } catch (error) {
      if (get().taskId === taskId) set((s) => ({ comments: s.comments.filter((c) => c.id !== tempId) }));
      if (isApiError(error, 401)) useAuthStore.getState().markAnonymous();
      resyncBoard(error);
      throw error;
    }
  },

  edit: async (commentId, rawContent) => {
    const content = rawContent.trim();
    const previous = get().comments.find((c) => c.id === commentId);
    if (isPending(previous) || !content || previous!.content === content) return;
    const before = previous!;

    set((s) => ({ comments: s.comments.map((c) => (c.id === commentId ? { ...c, content, edited: true } : c)) }));
    try {
      const { comment } = await api.comments.update(commentId, { content });
      set((s) => ({ comments: s.comments.map((c) => (c.id === commentId ? comment : c)) }));
    } catch (error) {
      // Roll back only if nobody changed the text again since our optimistic edit.
      set((s) => ({ comments: s.comments.map((c) => (c.id === commentId && c.content === content ? { ...c, content: before.content, edited: before.edited } : c)) }));
      reportFailure(error, "Couldn't save the comment.");
      resyncBoard(error);
    }
  },

  remove: async (commentId) => {
    const index = get().comments.findIndex((c) => c.id === commentId);
    if (index < 0 || isPending(get().comments[index])) return;
    const removed = get().comments[index];

    set((s) => ({ comments: s.comments.filter((c) => c.id !== commentId) }));
    try {
      await api.comments.delete(commentId);
    } catch (error) {
      if (isApiError(error, 404)) return; // already gone
      set((s) => (s.comments.some((c) => c.id === commentId) ? s : { comments: [...s.comments.slice(0, index), removed, ...s.comments.slice(index)] }));
      reportFailure(error, "Couldn't delete the comment.");
      resyncBoard(error);
    }
  },
}));
