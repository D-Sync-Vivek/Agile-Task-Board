import { create } from "zustand";

/** State of the live connection, for the little indicator in the board header. */
export type RealtimeStatus = "idle" | "connecting" | "live" | "reconnecting" | "offline";

interface RealtimeState {
  status: RealtimeStatus;
  setStatus: (status: RealtimeStatus) => void;
}

export const useRealtimeStore = create<RealtimeState>((set) => ({
  status: "idle",
  setStatus: (status) => set({ status }),
}));
