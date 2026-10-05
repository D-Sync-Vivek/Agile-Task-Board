import { create } from "zustand";
import { api } from "@/lib/api";
import { getErrorMessage, isApiError } from "@/lib/errors";
import { useAuthStore } from "@/store/useAuthStore";
import type { BoardSummary } from "@/types/api";

type ListStatus = "idle" | "loading" | "ready" | "error";

interface BoardListState {
  boards: BoardSummary[];
  status: ListStatus;
  error: string | null;
  load: (signal?: AbortSignal) => Promise<void>;
  /** Throws on failure so the form can show validation messages. */
  createBoard: (name: string) => Promise<BoardSummary>;
  reset: () => void;
}

let loadSeq = 0;

export const useBoardListStore = create<BoardListState>((set) => ({
  boards: [],
  status: "idle",
  error: null,

  load: async (signal) => {
    const seq = ++loadSeq;
    set({ status: "loading", error: null });
    try {
      const { boards } = await api.boards.list({ signal });
      if (seq !== loadSeq || signal?.aborted) return;
      set({ boards, status: "ready" });
    } catch (error) {
      if (seq !== loadSeq || signal?.aborted) return;
      if (isApiError(error, 401)) useAuthStore.getState().markAnonymous();
      set({ status: "error", error: getErrorMessage(error, "Unable to load your boards.") });
    }
  },

  createBoard: async (name) => {
    const { board } = await api.boards.create({ name });
    set((state) => ({ boards: [board, ...state.boards], status: "ready" }));
    return board;
  },

  reset: () => {
    loadSeq++;
    set({ boards: [], status: "idle", error: null });
  },
}));
