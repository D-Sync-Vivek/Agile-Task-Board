import { create } from "zustand";

export type ToastKind = "error" | "success";
export interface Toast {
  id: number;
  kind: ToastKind;
  message: string;
}

interface ToastState {
  toasts: Toast[];
  push: (kind: ToastKind, message: string) => void;
  dismiss: (id: number) => void;
}

const AUTO_DISMISS_MS = 6000;
const MAX_VISIBLE = 4;
let nextId = 1;

/** Non-blocking notifications (replaces alert()). Errors from rolled-back optimistic updates land here. */
export const useToastStore = create<ToastState>((set, get) => ({
  toasts: [],
  push: (kind, message) => {
    const id = nextId++;
    set((state) => ({ toasts: [...state.toasts, { id, kind, message }].slice(-MAX_VISIBLE) }));
    setTimeout(() => get().dismiss(id), AUTO_DISMISS_MS);
  },
  dismiss: (id) => set((state) => ({ toasts: state.toasts.filter((t) => t.id !== id) })),
}));

export const toast = {
  error: (message: string) => useToastStore.getState().push("error", message),
  success: (message: string) => useToastStore.getState().push("success", message),
};
