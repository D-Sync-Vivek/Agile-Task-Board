import type { Request, RequestHandler } from "express";
import * as memberService from "../services/member.service";
import { broadcast, evictUser, flushActivity } from "../sockets/realtime";
import { AppError } from "../utils/AppError";
import type { AddMemberInput, UpdateMemberInput } from "../validators/member.validator";

// Handlers run behind requireAuth + requireBoardPermission (req.user, req.boardMembership).
function context(req: Request) {
  if (!req.user || !req.boardMembership) throw new AppError(401, "UNAUTHORIZED", "Authentication required");
  return { actorId: req.user.id, boardId: req.boardMembership.boardId };
}

export const list: RequestHandler = async (req, res) => {
  const members = await memberService.listMembers(context(req).boardId);
  res.status(200).json({ success: true, data: { members } });
};

export const add: RequestHandler = async (req, res) => {
  const { actorId, boardId } = context(req);
  const member = await memberService.addMember(boardId, actorId, req.body as AddMemberInput);
  broadcast(req, boardId, "member:added", { member, actorId });
  flushActivity(boardId);
  res.status(201).json({ success: true, data: { member } });
};

export const updateRole: RequestHandler = async (req, res) => {
  const { actorId, boardId } = context(req);
  const member = await memberService.updateMemberRole(boardId, actorId, String(req.params.memberId), req.body as UpdateMemberInput);
  broadcast(req, boardId, "member:updated", { member, actorId });
  flushActivity(boardId);
  res.status(200).json({ success: true, data: { member } });
};

export const remove: RequestHandler = async (req, res) => {
  const { actorId, boardId } = context(req);
  const memberId = String(req.params.memberId);
  const { userId, unassignedTasks } = await memberService.removeMember(boardId, actorId, memberId);
  // Announce first (the removed user is still in the room and learns they were removed), then take them out of it.
  broadcast(req, boardId, "member:removed", { memberId, userId, actorId });
  flushActivity(boardId);
  await evictUser(boardId, userId);
  res.status(200).json({ success: true, data: { unassignedTasks } });
};
