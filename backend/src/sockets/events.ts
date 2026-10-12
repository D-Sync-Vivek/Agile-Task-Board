import type { ActivityDto } from "../services/activity.service";

/**
 * The real-time contract. Every event is a NOTIFICATION that something already committed to PostgreSQL; clients
 * apply it to their cache, they never treat it as the source of truth. Payloads carry the same DTOs the REST API
 * returns, so one parser on the client handles both.
 */

type Dto = Record<string, unknown>;
export type Ack = { ok: true } | { ok: false; error: { code: string; message: string } };

export interface ServerToClientEvents {
  "task:created": (p: { task: Dto; actorId: string }) => void;
  "task:updated": (p: { task: Dto; actorId: string }) => void; // field edits and (re)assignment
  "task:moved": (p: { task: Dto; columns: unknown; actorId: string }) => void; // `columns`: the affected columns' new task order, as in the REST response
  "task:deleted": (p: { taskId: string; actorId: string }) => void;

  "column:created": (p: { column: Dto; actorId: string }) => void;
  "column:updated": (p: { column: Dto; actorId: string }) => void;
  "column:deleted": (p: { columnId: string; actorId: string }) => void; // its tasks went with it
  "column:reordered": (p: { columns: unknown; actorId: string }) => void;

  "comment:created": (p: { comment: Dto; taskId: string; actorId: string }) => void;
  "comment:updated": (p: { comment: Dto; taskId: string; actorId: string }) => void;
  "comment:deleted": (p: { commentId: string; taskId: string; actorId: string }) => void;

  "member:added": (p: { member: Dto; actorId: string }) => void;
  "member:updated": (p: { member: Dto; actorId: string }) => void; // role change
  "member:removed": (p: { memberId: string; userId: string; actorId: string }) => void; // also delivered to the removed user, right before they are dropped from the room

  "board:updated": (p: { board: Dto; actorId: string }) => void;
  "board:deleted": (p: { boardId: string; actorId: string }) => void;

  "activity:created": (p: { activity: ActivityDto }) => void;
}

export interface ClientToServerEvents {
  "board:join": (payload: unknown, ack?: (response: Ack) => void) => void;
  "board:leave": (payload: unknown, ack?: (response: Ack) => void) => void;
}

export interface SocketData {
  userId: string;
}

export type ServerEventName = keyof ServerToClientEvents;
export type PayloadOf<E extends ServerEventName> = Parameters<ServerToClientEvents[E]>[0];
