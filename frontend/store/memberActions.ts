import { api } from "@/lib/api";
import { ApiError } from "@/lib/api/client";
import { isApiError } from "@/lib/errors";
import { useAuthStore } from "@/store/useAuthStore";
import { useBoardStore } from "@/store/useBoardStore";
import type { AssignableRole, BoardMemberDto } from "@/types/api";

/**
 * Member management for the open board. Unlike moving a card, these are SERVER-CONFIRMED (not optimistic): who is
 * on a board is an access-control decision, so the UI only changes once the server has accepted it. Each function
 * updates the board store from the server's answer and THROWS the ApiError so the panel can show it next to the
 * control that caused it.
 */

function replaceMembers(update: (members: BoardMemberDto[]) => BoardMemberDto[]) {
  useBoardStore.setState((s) => (s.board ? { board: { ...s.board, members: update(s.board.members) } } : s));
}

/** Our picture of the board is stale or our session is gone: react, then let the caller show the error. */
function handleFailure(error: unknown, boardId: string) {
  if (isApiError(error, 401)) {
    useAuthStore.getState().markAnonymous();
    return;
  }
  // 403/404 on update/remove: someone changed the member list or our own role. Re-read instead of guessing.
  if (isApiError(error, 403) || isApiError(error, 404) || isApiError(error, 409)) {
    if (useBoardStore.getState().board?.id === boardId) void useBoardStore.getState().loadBoard(boardId, { silent: true });
  }
}

/** "No such user" / "already a member" answer the form's question; they don't mean the board is out of date. */
const isFormAnswer = (error: unknown) => error instanceof ApiError && (error.code === "USER_NOT_FOUND" || error.code === "ALREADY_MEMBER");

export async function addMember(boardId: string, email: string, role: AssignableRole): Promise<void> {
  try {
    const { member } = await api.members.add(boardId, { email, role });
    replaceMembers((members) => (members.some((m) => m.id === member.id) ? members : [...members, member]));
  } catch (error) {
    if (!isFormAnswer(error)) handleFailure(error, boardId);
    throw error;
  }
}

export async function changeMemberRole(boardId: string, memberId: string, role: AssignableRole): Promise<void> {
  try {
    const { member } = await api.members.updateRole(boardId, memberId, role);
    replaceMembers((members) => members.map((m) => (m.id === memberId ? member : m)));
  } catch (error) {
    handleFailure(error, boardId);
    throw error;
  }
}

export async function removeMember(boardId: string, memberId: string): Promise<void> {
  const removed = useBoardStore.getState().board?.members.find((m) => m.id === memberId);
  try {
    await api.members.remove(boardId, memberId);
  } catch (error) {
    if (!isApiError(error, 404)) {
      handleFailure(error, boardId);
      throw error;
    }
    handleFailure(error, boardId); // 404: already gone (or we lost access) - the goal is met, re-read to be sure
  }
  replaceMembers((members) => members.filter((m) => m.id !== memberId));
  // The server unassigned their tasks in the same transaction; mirror that here instead of waiting for a reload.
  if (removed) useBoardStore.setState((s) => ({ tasks: s.tasks.map((t) => (t.assigneeId === removed.userId ? { ...t, assigneeId: null } : t)) }));
}
