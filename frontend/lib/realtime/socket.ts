import { io } from "socket.io-client";
import type { ManagerOptions, Socket, SocketOptions } from "socket.io-client";
import type { ClientToServerEvents, ServerToClientEvents } from "@/types/realtime";

export type BoardSocket = Socket<ServerToClientEvents, ClientToServerEvents>;

/**
 * This tab's one live connection (there is at most one: it belongs to the board being viewed).
 * Kept in a module so the REST client can read its id without importing any React or store code.
 */
let current: BoardSocket | null = null;

export const getSocketId = (): string | undefined => current?.id;

/**
 * Opens the connection, replacing any previous one. Authentication is the same HTTP-only cookie the REST API uses
 * (sent with the handshake because of `withCredentials`), so no token ever passes through JavaScript.
 * WebSocket only: no long-polling fallback to keep working across multiple server instances' sticky-session needs.
 */
export function openSocket(url: string, options: Partial<ManagerOptions & SocketOptions> = {}): BoardSocket {
  closeSocket();
  current = io(url, { withCredentials: true, transports: ["websocket"], reconnectionDelayMax: 5000, ...options });
  return current;
}

/** Removes every listener and disconnects: nothing from this connection can reach the app afterwards. */
export function closeSocket(): void {
  if (!current) return;
  current.removeAllListeners();
  current.disconnect();
  current = null;
}
