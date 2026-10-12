import type { Request } from "express";
import type { Server } from "socket.io";
import type { ClientToServerEvents, PayloadOf, ServerEventName, ServerToClientEvents, SocketData } from "./events";
import { drainActivity } from "./outbox";

export type BoardServer = Server<ClientToServerEvents, ServerToClientEvents, Record<string, never>, SocketData>;

/** One room per board. A socket is only ever put into it after the server checked the user's membership. */
export const boardRoom = (boardId: string) => `board:${boardId}`;

let io: BoardServer | null = null;

export function setRealtimeServer(server: BoardServer | null): void {
  io = server;
}

/**
 * Tells everyone currently viewing the board. Called by controllers AFTER the change committed, never from inside a
 * transaction. It must never break the request that triggered it: the database already has the truth, and clients
 * that miss an event recover on their next fetch. So: no server (tests, scripts) = no-op, and errors are logged.
 *
 * The browser tab that made the change sends its socket id in `X-Socket-Id`; it is skipped, because it has already
 * applied the change optimistically.
 */
export function broadcast<E extends ServerEventName>(req: Request, boardId: string, event: E, payload: PayloadOf<E>): void {
  if (!io) return;
  try {
    const excluded = req.get("x-socket-id");
    const target = excluded ? io.to(boardRoom(boardId)).except(excluded) : io.to(boardRoom(boardId));
    (target.emit as (event: string, payload: unknown) => boolean)(event, payload);
  } catch (error) {
    console.error(`Failed to broadcast ${event}:`, error);
  }
}

/**
 * Sends the activity entries the request created. Unlike `broadcast`, this goes to EVERYONE in the room, including
 * the sender: an activity entry is created by the server, so no client has it yet.
 */
export function flushActivity(boardId: string): void {
  const entries = drainActivity();
  if (!io) return;
  for (const activity of entries) {
    try {
      io.to(boardRoom(boardId)).emit("activity:created", { activity });
    } catch (error) {
      console.error("Failed to broadcast activity:created:", error);
    }
  }
}

/** Takes every socket of one user out of a board's room (they were removed from the board). */
export async function evictUser(boardId: string, userId: string): Promise<void> {
  if (!io) return;
  const room = boardRoom(boardId);
  for (const socket of await io.in(room).fetchSockets()) {
    if (socket.data.userId === userId) socket.leave(room);
  }
}

/** Empties a board's room (the board was deleted). */
export function evictEveryone(boardId: string): void {
  io?.in(boardRoom(boardId)).socketsLeave(boardRoom(boardId));
}
