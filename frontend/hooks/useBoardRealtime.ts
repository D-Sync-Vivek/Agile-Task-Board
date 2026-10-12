"use client";
import { useRouter } from "next/navigation";
import { useEffect, useRef } from "react";
import { API_URL } from "@/lib/config";
import { registerBoardHandlers, resyncAfterReconnect } from "@/lib/realtime/handlers";
import { closeSocket, openSocket } from "@/lib/realtime/socket";
import { useAuthStore } from "@/store/useAuthStore";
import { useBoardStore } from "@/store/useBoardStore";
import { useRealtimeStore } from "@/store/useRealtimeStore";
import { toast } from "@/store/useToastStore";

const JOIN_TIMEOUT_MS = 10_000;

/**
 * Keeps the open board live: connects, joins the board's room, applies what others do, and cleans up completely
 * when the board is left (listeners removed, connection closed, so nothing can fire into a stale page).
 *
 * The server is the source of truth and delivery isn't guaranteed, so after every (re)join the board is simply
 * re-read. That also covers changes made between the initial page load and the moment we joined the room.
 */
export function useBoardRealtime(boardId: string, enabled: boolean): void {
  const router = useRouter();
  const routerRef = useRef(router);
  useEffect(() => {
    routerRef.current = router;
  });

  useEffect(() => {
    if (!enabled) return;
    const setStatus = useRealtimeStore.getState().setStatus;
    setStatus("connecting");

    const socket = openSocket(API_URL);

    // Set to false the moment this effect is cleaned up (board left, or switched). Anything still in flight for this
    // connection — a join waiting for its answer, a timeout about to fire — must then do NOTHING: it belongs to a
    // board that is no longer open, and acting on it would re-read the wrong board, reconnect a socket that was
    // closed on purpose, or overwrite the status of the connection that replaced it.
    let active = true;

    const leaveBoard = (message: string, kind: "error" | "info") => {
      toast[kind](message);
      useBoardStore.getState().reset();
      routerRef.current.replace("/");
    };
    registerBoardHandlers(socket, {
      onRemovedFromBoard: () => leaveBoard("You were removed from this board.", "error"),
      onBoardDeleted: () => leaveBoard("This board was deleted.", "info"),
    });

    // Runs on the first connection AND on every automatic reconnection (a new connection starts in no rooms).
    socket.on("connect", async () => {
      try {
        const ack = await socket.timeout(JOIN_TIMEOUT_MS).emitWithAck("board:join", { boardId });
        if (!active) return;
        if (ack.ok) {
          setStatus("live");
          resyncAfterReconnect(boardId);
        } else {
          // Access is gone (removed / board deleted): the board load shows "not found"; no point staying connected.
          setStatus("offline");
          void useBoardStore.getState().loadBoard(boardId, { silent: true });
        }
      } catch {
        if (!active) return;
        setStatus("reconnecting"); // no answer in time
        socket.disconnect().connect();
      }
    });

    socket.on("disconnect", (reason) => {
      // "io server disconnect": the server ended it (our session expired). The client does NOT retry on its own then.
      if (reason === "io server disconnect") {
        setStatus("offline");
        useAuthStore.getState().markAnonymous();
      } else {
        setStatus("reconnecting");
      }
    });

    socket.on("connect_error", (error) => {
      if (error.message === "UNAUTHORIZED") {
        setStatus("offline");
        useAuthStore.getState().markAnonymous();
      } else if (error.message === "FORBIDDEN_ORIGIN") {
        setStatus("offline"); // misconfiguration: retrying can't help
      } else {
        setStatus("reconnecting"); // network trouble: the client keeps retrying with backoff
      }
    });

    return () => {
      active = false;
      closeSocket();
      setStatus("idle");
    };
  }, [boardId, enabled]);
}
