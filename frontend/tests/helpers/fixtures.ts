import type { BoardDetail, ColumnDto, Permission, TaskDto } from "@/types/api";
import { ApiError } from "@/lib/api/client";

const NOW = "2026-10-04T10:00:00.000Z";

export const ALL_PERMISSIONS: Permission[] = [
  "board:view", "board:update", "board:delete", "member:manage", "column:create", "column:update",
  "column:delete", "task:create", "task:update", "task:move", "task:delete", "comment:create",
];
export const VIEWER_PERMISSIONS: Permission[] = ["board:view"];

export const makeColumn = (id: string, title: string, position: number): ColumnDto => ({
  id, boardId: "b1", title, position, createdAt: NOW, updatedAt: NOW,
});

export const makeTask = (id: string, columnId: string, title: string, position: number): TaskDto => ({
  id, boardId: "b1", columnId, title, description: null, priority: "MEDIUM", assigneeId: null,
  createdById: "u1", position, dueDate: null, createdAt: NOW, updatedAt: NOW,
});

export function makeBoard(overrides: Partial<BoardDetail> = {}): BoardDetail {
  return {
    id: "b1", name: "Sprint Board", description: null, ownerId: "u1", createdAt: NOW, updatedAt: NOW,
    myRole: "OWNER", myPermissions: ALL_PERMISSIONS, members: [],
    columns: [makeColumn("c1", "Todo", 0), makeColumn("c2", "Doing", 1)],
    tasks: [makeTask("t1", "c1", "Write tests", 0), makeTask("t2", "c1", "Ship it", 1), makeTask("t3", "c2", "Review", 0)],
    ...overrides,
  };
}

export const apiError = (status: number, code: string, message = code) => new ApiError(status, code, message);

/** A promise you resolve/reject by hand, to observe state while a request is "in flight". */
export function deferred<T = unknown>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

/** Lets pending promise callbacks run. */
export const flush = () => new Promise<void>((resolve) => setTimeout(resolve, 0));
