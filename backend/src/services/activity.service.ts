import { prisma } from "../config/prisma";
import type { ActivityAction, ActivityEntityType, BoardRole, Prisma } from "../generated/prisma/client";
import type { Tx } from "./boardLock";

/**
 * What each action stores in ActivityLog.metadata. These are SNAPSHOTS taken when the event happened (titles,
 * names), so the feed still reads correctly after the task/column/user is renamed or deleted — the log has no
 * foreign key to the entity for the same reason.
 */
type ColumnRef = { id: string; title: string };
type PersonRef = { id: string; name: string };

export interface TaskFieldChanges {
  title?: { from: string; to: string };
  priority?: { from: string; to: string };
  dueDate?: { from: string | null; to: string | null };
  /** Descriptions can be long, so only the fact that it changed is recorded, not the text. */
  description?: true;
}

export interface ActivityMetadataMap {
  TASK_CREATED: { taskTitle: string; columnTitle: string };
  TASK_UPDATED: { taskTitle: string; changes: TaskFieldChanges };
  TASK_DELETED: { taskTitle: string; columnTitle: string };
  TASK_MOVED: { taskTitle: string; fromColumn: ColumnRef; toColumn: ColumnRef };
  TASK_ASSIGNED: { taskTitle: string; from: PersonRef | null; to: PersonRef | null };
  COLUMN_CREATED: { columnTitle: string };
  COLUMN_RENAMED: { from: string; to: string };
  COLUMN_DELETED: { columnTitle: string; taskCount: number };
  MEMBER_ADDED: { memberName: string; role: BoardRole };
  MEMBER_ROLE_CHANGED: { memberName: string; from: BoardRole; to: BoardRole };
  MEMBER_REMOVED: { memberName: string };
  COMMENT_ADDED: { taskId: string; taskTitle: string };
}

/** Which kind of entity `entityId` refers to, per action: one definition, so callers can't mismatch them. */
const ENTITY_TYPE: Record<ActivityAction, ActivityEntityType> = {
  TASK_CREATED: "TASK",
  TASK_UPDATED: "TASK",
  TASK_DELETED: "TASK",
  TASK_MOVED: "TASK",
  TASK_ASSIGNED: "TASK",
  COLUMN_CREATED: "COLUMN",
  COLUMN_RENAMED: "COLUMN",
  COLUMN_DELETED: "COLUMN",
  MEMBER_ADDED: "MEMBER",
  MEMBER_ROLE_CHANGED: "MEMBER",
  MEMBER_REMOVED: "MEMBER",
  COMMENT_ADDED: "COMMENT",
};

/**
 * Writes one activity row. Services call this with THEIR transaction client, so the event is committed (or rolled
 * back) together with the change it describes: history can never describe something that didn't happen, and a
 * change can never go unrecorded.
 */
export async function recordActivity<A extends ActivityAction>(
  db: Pick<Tx, "activityLog">,
  event: { boardId: string; userId: string; action: A; entityId: string; metadata: ActivityMetadataMap[A] }
) {
  const row = await db.activityLog.create({
    data: {
      boardId: event.boardId,
      userId: event.userId,
      action: event.action,
      entityType: ENTITY_TYPE[event.action],
      entityId: event.entityId,
      metadata: event.metadata as unknown as Prisma.InputJsonValue,
    },
    select: activitySelect,
  });
  return toActivityDto(row);
}

const activitySelect = {
  id: true,
  boardId: true,
  action: true,
  entityType: true,
  entityId: true,
  metadata: true,
  createdAt: true,
  user: { select: { id: true, name: true, avatar: true } },
} as const;

type ActivityRow = Prisma.ActivityLogGetPayload<{ select: typeof activitySelect }>;

/** API shape of an activity entry: the actor is public info only (no email). */
export function toActivityDto(row: ActivityRow) {
  const { user, ...rest } = row;
  return { ...rest, actor: user };
}

export type ActivityDto = ReturnType<typeof toActivityDto>;

export const DEFAULT_ACTIVITY_LIMIT = 30;
export const MAX_ACTIVITY_LIMIT = 100;

interface ListOptions {
  limit?: number;
  /** Id of the last entry of the previous page. */
  cursor?: string;
  /** Restrict to one task's history (task events + comments on it). */
  taskId?: string;
}

/**
 * Newest first, cursor-paginated (offset pagination would skip/duplicate rows while new events keep arriving).
 * Ordered by (createdAt, id) so entries created in the same millisecond have a stable order. Served by the
 * (boardId, createdAt DESC) index.
 */
export async function listActivity(boardId: string, options: ListOptions = {}) {
  const limit = Math.min(options.limit ?? DEFAULT_ACTIVITY_LIMIT, MAX_ACTIVITY_LIMIT);

  const where: Prisma.ActivityLogWhereInput = { boardId };
  if (options.taskId) {
    where.OR = [
      { entityType: "TASK", entityId: options.taskId },
      { entityType: "COMMENT", metadata: { path: ["taskId"], equals: options.taskId } },
    ];
  }

  const rows = await prisma.activityLog.findMany({
    where,
    select: activitySelect,
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: limit + 1, // one extra row tells us whether another page exists
    ...(options.cursor && { cursor: { id: options.cursor }, skip: 1 }),
  });

  const hasMore = rows.length > limit;
  const page = hasMore ? rows.slice(0, limit) : rows;
  return { activities: page.map(toActivityDto), nextCursor: hasMore ? page[page.length - 1].id : null };
}
