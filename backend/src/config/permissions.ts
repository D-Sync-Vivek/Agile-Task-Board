import type { BoardRole } from "../generated/prisma/client";

/**
 * Every action a route can require. Routes ask for a PERMISSION, never for a role:
 * "who may do what" lives only in ROLE_PERMISSIONS below, so changing policy is a one-file change.
 *
 * Viewing a board covers reading its columns, tasks, comments and activity ("board:view").
 */
export const PERMISSIONS = [
  "board:view",
  "board:update",
  "board:delete",
  "member:manage",
  "column:create",
  "column:update",
  "column:delete",
  "task:create",
  "task:update",
  "task:move",
  "task:delete",
  "comment:create",
  "comment:moderate", // delete other people's comments
] as const;

export type Permission = (typeof PERMISSIONS)[number];

const VIEWER: readonly Permission[] = ["board:view"];

const MEMBER: readonly Permission[] = [...VIEWER, "task:create", "task:update", "task:move", "comment:create"];

const ADMIN: readonly Permission[] = [
  ...MEMBER,
  "member:manage",
  "column:create",
  "column:update",
  "column:delete",
  "task:delete",
  "comment:moderate",
];

const OWNER: readonly Permission[] = [...ADMIN, "board:update", "board:delete"];

export const ROLE_PERMISSIONS: Record<BoardRole, ReadonlySet<Permission>> = {
  OWNER: new Set(OWNER),
  ADMIN: new Set(ADMIN),
  MEMBER: new Set(MEMBER),
  VIEWER: new Set(VIEWER),
};

export function roleHasPermission(role: BoardRole, permission: Permission): boolean {
  return ROLE_PERMISSIONS[role].has(permission);
}
