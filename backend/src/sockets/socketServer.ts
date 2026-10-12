import type { Server as HttpServer } from "node:http";
import { parseCookie } from "cookie";
import { Server } from "socket.io";
import { z } from "zod";
import { env } from "../config/env";
import { decodeAuthToken, getPublicUserById } from "../services/auth.service";
import { getBoardMembership } from "../services/authorization.service";
import { AUTH_COOKIE_NAME } from "../utils/cookies";
import type { Ack } from "./events";
import { boardRoom, setRealtimeServer } from "./realtime";
import type { BoardServer } from "./realtime";

/** A socket can watch several boards (several tabs share nothing, but one tab may switch boards), but not unboundedly many. */
const MAX_BOARDS_PER_SOCKET = 20;

const boardPayload = z.object({ boardId: z.uuid() });

const NOT_FOUND: Ack = { ok: false, error: { code: "BOARD_NOT_FOUND", message: "Board not found" } };
const invalid = (message: string): Ack => ({ ok: false, error: { code: "VALIDATION_ERROR", message } });

/**
 * Attaches Socket.IO to the HTTP server.
 *
 * Authentication happens ONCE, at connection, with the same HTTP-only cookie the REST API uses (the browser sends it
 * with the handshake; no token ever lives in JavaScript). Authorization happens on every `board:join`, against the
 * database, with the same membership lookup the REST API uses. Nothing is broadcast to a socket that isn't in the room.
 */
export function attachSocketServer(httpServer: HttpServer): BoardServer {
  const io: BoardServer = new Server(httpServer, {
    cors: { origin: env.CLIENT_ORIGIN, credentials: true },
  });

  io.use(async (socket, next) => {
    try {
      // Cross-site WebSocket hijacking: browsers attach cookies to WebSocket handshakes from ANY site, and CORS does
      // not apply to them. So, like originGuard for REST, a browser handshake must come from our frontend.
      const origin = socket.handshake.headers.origin;
      if (origin && origin !== env.CLIENT_ORIGIN) return next(new Error("FORBIDDEN_ORIGIN"));

      const token = parseCookie(socket.handshake.headers.cookie ?? "")[AUTH_COOKIE_NAME];
      const decoded = token ? decodeAuthToken(token) : null;
      const user = decoded ? await getPublicUserById(decoded.userId) : null;
      if (!decoded || !user) return next(new Error("UNAUTHORIZED"));

      socket.data.userId = user.id;

      // The cookie has a lifetime; the connection must not outlive it. (Logging out in the browser can't reach us.)
      const timer = setTimeout(() => socket.disconnect(true), Math.min(decoded.expiresAt.getTime() - Date.now(), 2 ** 31 - 1));
      timer.unref();
      socket.once("disconnect", () => clearTimeout(timer));
      next();
    } catch (error) {
      next(error instanceof Error ? error : new Error("UNAUTHORIZED"));
    }
  });

  io.on("connection", (socket) => {
    const joined = () => [...socket.rooms].filter((room) => room.startsWith("board:")).length;

    socket.on("board:join", async (payload, ack) => {
      const reply = typeof ack === "function" ? ack : () => undefined;
      try {
        const parsed = boardPayload.safeParse(payload);
        if (!parsed.success) return reply(invalid("boardId must be a valid id"));
        const { boardId } = parsed.data;

        // Not a member and no such board look identical, as in the REST API.
        if (!(await getBoardMembership(socket.data.userId, boardId))) return reply(NOT_FOUND);
        if (!socket.rooms.has(boardRoom(boardId)) && joined() >= MAX_BOARDS_PER_SOCKET) return reply(invalid("Too many boards open at once"));

        await socket.join(boardRoom(boardId));
        // The membership could have been revoked between the check and the join (and the eviction already ran): check again.
        if (!(await getBoardMembership(socket.data.userId, boardId))) {
          await socket.leave(boardRoom(boardId));
          return reply(NOT_FOUND);
        }
        reply({ ok: true });
      } catch (error) {
        console.error("board:join failed:", error);
        reply({ ok: false, error: { code: "INTERNAL_ERROR", message: "Something went wrong" } });
      }
    });

    socket.on("board:leave", async (payload, ack) => {
      const reply = typeof ack === "function" ? ack : () => undefined;
      const parsed = boardPayload.safeParse(payload);
      if (!parsed.success) return reply(invalid("boardId must be a valid id"));
      await socket.leave(boardRoom(parsed.data.boardId));
      reply({ ok: true });
    });
  });

  setRealtimeServer(io);
  return io;
}
