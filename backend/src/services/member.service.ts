import { isRoleBelow, roleHasPermission } from "../config/permissions";
import { prisma } from "../config/prisma";
import type { BoardRole } from "../generated/prisma/client";
import { AppError } from "../utils/AppError";
import { memberSelect } from "../utils/serializers";
import type { AddMemberInput, UpdateMemberInput } from "../validators/member.validator";
import { recordActivity } from "./activity.service";
import { lockBoard } from "./boardLock";
import type { Tx } from "./boardLock";

const memberNotFound = () => new AppError(404, "MEMBER_NOT_FOUND", "Member not found");
const roleNotAllowed = (message: string) => new AppError(403, "FORBIDDEN", message);

export async function listMembers(boardId: string) {
  return prisma.boardMember.findMany({ where: { boardId }, select: memberSelect, orderBy: { createdAt: "asc" } });
}

/**
 * Re-reads the actor's role INSIDE the transaction, after the board lock. The route guard already checked it, but
 * that was a moment ago: if the actor was demoted or removed meanwhile (by someone holding the lock before us), the
 * decision must use the current role, not the one the request started with.
 */
async function currentManagerRole(tx: Tx, boardId: string, actorId: string): Promise<BoardRole> {
  const actor = await tx.boardMember.findUnique({ where: { boardId_userId: { boardId, userId: actorId } }, select: { role: true } });
  if (!actor) throw new AppError(404, "BOARD_NOT_FOUND", "Board not found");
  if (!roleHasPermission(actor.role, "member:manage")) throw new AppError(403, "FORBIDDEN", "You do not have permission to perform this action");
  return actor.role;
}

/** The target member, who must rank below the actor (this also rules out the owner and the actor themselves). */
async function manageableTarget(tx: Tx, boardId: string, memberId: string, actorRole: BoardRole) {
  const target = await tx.boardMember.findFirst({ where: { id: memberId, boardId }, select: { id: true, userId: true, role: true, user: { select: { name: true } } } });
  if (!target) throw memberNotFound();
  if (!isRoleBelow(target.role, actorRole)) throw roleNotAllowed("You can only manage members with a lower role than yours");
  return target;
}

/** Adds an existing user (looked up by email) to the board. */
export function addMember(boardId: string, actorId: string, input: AddMemberInput) {
  return prisma.$transaction(async (tx) => {
    await lockBoard(tx, boardId);
    const actorRole = await currentManagerRole(tx, boardId, actorId);
    if (!isRoleBelow(input.role, actorRole)) throw roleNotAllowed("You can only grant roles lower than your own");

    const user = await tx.user.findUnique({ where: { email: input.email }, select: { id: true, name: true } });
    if (!user) throw new AppError(404, "USER_NOT_FOUND", "No user with that email address. They need to register first.");
    const existing = await tx.boardMember.findUnique({ where: { boardId_userId: { boardId, userId: user.id } }, select: { id: true } });
    if (existing) throw new AppError(409, "ALREADY_MEMBER", "That user is already a member of this board");

    const member = await tx.boardMember.create({ data: { boardId, userId: user.id, role: input.role }, select: memberSelect });
    await recordActivity(tx, { boardId, userId: actorId, action: "MEMBER_ADDED", entityId: user.id, metadata: { memberName: user.name, role: member.role } });
    return member;
  });
}

/** Changes a member's role. Setting the role they already have changes (and logs) nothing. */
export function updateMemberRole(boardId: string, actorId: string, memberId: string, input: UpdateMemberInput) {
  return prisma.$transaction(async (tx) => {
    await lockBoard(tx, boardId);
    const actorRole = await currentManagerRole(tx, boardId, actorId);
    const target = await manageableTarget(tx, boardId, memberId, actorRole);
    if (!isRoleBelow(input.role, actorRole)) throw roleNotAllowed("You can only grant roles lower than your own");

    if (target.role === input.role) return tx.boardMember.findUniqueOrThrow({ where: { id: memberId }, select: memberSelect });

    const member = await tx.boardMember.update({ where: { id: memberId }, data: { role: input.role }, select: memberSelect });
    await recordActivity(tx, {
      boardId,
      userId: actorId,
      action: "MEMBER_ROLE_CHANGED",
      entityId: target.userId,
      metadata: { memberName: target.user.name, from: target.role, to: member.role },
    });
    return member;
  });
}

/**
 * Removes a member. Tasks assigned to them become unassigned in the same transaction (an assignee must always be a
 * board member); their comments stay, attributed to them. Returns how many tasks were unassigned.
 */
export function removeMember(boardId: string, actorId: string, memberId: string): Promise<{ userId: string; unassignedTasks: number }> {
  return prisma.$transaction(async (tx) => {
    await lockBoard(tx, boardId);
    const actorRole = await currentManagerRole(tx, boardId, actorId);
    const target = await manageableTarget(tx, boardId, memberId, actorRole);

    const { count } = await tx.task.updateMany({ where: { boardId, assigneeId: target.userId }, data: { assigneeId: null } });
    await tx.boardMember.delete({ where: { id: memberId } });
    await recordActivity(tx, {
      boardId,
      userId: actorId,
      action: "MEMBER_REMOVED",
      entityId: target.userId,
      metadata: { memberName: target.user.name, unassignedTasks: count },
    });
    return { userId: target.userId, unassignedTasks: count };
  });
}
