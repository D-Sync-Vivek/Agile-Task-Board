import { create } from "zustand";
import { api } from "@/lib/api";
import { isApiError } from "@/lib/errors";
import type { ApiUser, LoginInput, RegisterInput } from "@/types/api";

/**
 * Who is signed in. The session itself is an HTTP-only cookie the browser manages; this store only caches the
 * user returned by the API (nothing is persisted to localStorage).
 *  unknown       -> haven't asked the server yet
 *  loading       -> asking
 *  authenticated -> `user` is set
 *  anonymous     -> no valid session
 *  error         -> couldn't reach the server (don't bounce the user to /login for that)
 */
export type AuthStatus = "unknown" | "loading" | "authenticated" | "anonymous" | "error";

interface AuthState {
  status: AuthStatus;
  user: ApiUser | null;
  fetchSession: () => Promise<void>;
  login: (input: LoginInput) => Promise<void>;
  register: (input: RegisterInput) => Promise<void>;
  logout: () => Promise<void>;
  /** Called when any API call returns 401 mid-session (e.g. the cookie expired). */
  markAnonymous: () => void;
}

export const useAuthStore = create<AuthState>((set, get) => ({
  status: "unknown",
  user: null,

  fetchSession: async () => {
    if (get().status === "loading") return;
    set({ status: "loading" });
    try {
      const { user } = await api.auth.me();
      set({ status: "authenticated", user });
    } catch (error) {
      if (isApiError(error, 401)) set({ status: "anonymous", user: null });
      else set({ status: "error" });
    }
  },

  // login/register throw on failure so the form can show field errors; the store only changes on success.
  login: async (input) => {
    const { user } = await api.auth.login(input);
    set({ status: "authenticated", user });
  },

  register: async (input) => {
    const { user } = await api.auth.register(input);
    set({ status: "authenticated", user });
  },

  logout: async () => {
    try {
      await api.auth.logout();
    } finally {
      // Even if the request failed, drop the local session view; the cookie expires on its own.
      set({ status: "anonymous", user: null });
    }
  },

  markAnonymous: () => set({ status: "anonymous", user: null }),
}));
