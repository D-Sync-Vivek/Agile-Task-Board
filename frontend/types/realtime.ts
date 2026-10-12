import type { AffectedColumn } from "@/lib/boardLayout";
import type { Column, Id, Task } from "@/types";
import type { ActivityDto, BoardMemberDto, CommentDto } from "@/types/api";

/**
 * What the server pushes (mirror of backend/src/sockets/events.ts). Every event announces something that is ALREADY
 * committed to PostgreSQL, and carries the same DTO the REST API returns. They are hints to update a cache, never
 * the source of truth: after a missed event or a reconnect the client simply re-fetches.
 */
export interface ServerToClientEvents {
  "task:created": (p: { task: Task; actorId: string }) => void;
  "task:updated": (p: { task: Task; actorId: string }) => void;
  "task:moved": (p: { task: Task; columns: AffectedColumn[]; actorId: string }) => void;
  "task:deleted": (p: { taskId: Id; actorId: string }) => void;

  "column:created": (p: { column: Column; actorId: string }) => void;
  "column:updated": (p: { column: Column; actorId: string }) => void;
  "column:deleted": (p: { columnId: Id; actorId: string }) => void;
  "column:reordered": (p: { columns: Column[]; actorId: string }) => void;

  "comment:created": (p: { comment: CommentDto; taskId: Id; actorId: string }) => void;
  "comment:updated": (p: { comment: CommentDto; taskId: Id; actorId: string }) => void;
  "comment:deleted": (p: { commentId: Id; taskId: Id; actorId: string }) => void;

  "member:added": (p: { member: BoardMemberDto; actorId: string }) => void;
  "member:updated": (p: { member: BoardMemberDto; actorId: string }) => void;
  "member:removed": (p: { memberId: Id; userId: Id; actorId: string }) => void;

  "board:updated": (p: { board: { name: string; description: string | null }; actorId: string }) => void;
  "board:deleted": (p: { boardId: Id; actorId: string }) => void;

  "activity:created": (p: { activity: ActivityDto }) => void;
}

export type JoinAck = { ok: true } | { ok: false; error: { code: string; message: string } };

export interface ClientToServerEvents {
  "board:join": (payload: { boardId: string }, ack: (response: JoinAck) => void) => void;
  "board:leave": (payload: { boardId: string }, ack: (response: JoinAck) => void) => void;
}
