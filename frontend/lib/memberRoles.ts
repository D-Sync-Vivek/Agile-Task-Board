import type { AssignableRole, BoardRole } from "@/types/api";

export const ROLE_LABEL: Record<BoardRole, string> = { OWNER: "Owner", ADMIN: "Admin", MEMBER: "Member", VIEWER: "Viewer" };

const RANK: Record<BoardRole, number> = { VIEWER: 1, MEMBER: 2, ADMIN: 3, OWNER: 4 };
const ASSIGNABLE: AssignableRole[] = ["ADMIN", "MEMBER", "VIEWER"];

/**
 * UI hints only — the backend enforces the real rule (backend/src/config/permissions.ts): you may only grant roles,
 * change roles and remove members that rank STRICTLY BELOW your own role. These helpers just avoid offering buttons
 * that would be refused.
 */
export const rolesBelow = (myRole: BoardRole): AssignableRole[] => ASSIGNABLE.filter((role) => RANK[role] < RANK[myRole]);

export const canManageMember = (myRole: BoardRole, targetRole: BoardRole): boolean => RANK[targetRole] < RANK[myRole];
