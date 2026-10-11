"use client";
import { useRef, useState } from "react";
import type { FormEvent } from "react";
import { useDialogFocus } from "@/hooks/useDialogFocus";
import { ApiError } from "@/lib/api/client";
import { getErrorMessage, getFieldErrors } from "@/lib/errors";
import { ROLE_LABEL, canManageMember, rolesBelow } from "@/lib/memberRoles";
import { useAuthStore } from "@/store/useAuthStore";
import { useBoardStore } from "@/store/useBoardStore";
import { addMember, changeMemberRole, removeMember } from "@/store/memberActions";
import type { AssignableRole, BoardMemberDto, BoardRole } from "@/types/api";

const inputClass = "w-full rounded border border-gray-700 bg-gray-950 px-3 py-2 text-sm text-white placeholder-gray-500 focus:border-rose-500 focus:outline-none disabled:opacity-60";

/** Board settings slide-over. Everyone on the board can see the member list; only OWNER/ADMIN get the controls. */
export default function BoardSettingsPanel({ onClose }: { onClose: () => void }) {
  const board = useBoardStore((s) => s.board);
  const me = useAuthStore((s) => s.user?.id);
  const dialogRef = useRef<HTMLDivElement>(null);
  useDialogFocus(dialogRef, onClose);
  if (!board) return null;

  const canManage = board.myPermissions.includes("member:manage");

  return (
    <div className="fixed inset-0 z-40 flex justify-end">
      <div className="absolute inset-0 bg-black/60" aria-hidden="true" onClick={onClose} />
      <div ref={dialogRef} role="dialog" aria-modal="true" aria-labelledby="board-settings-heading" className="relative h-full w-full max-w-md overflow-y-auto border-l border-gray-800 bg-gray-900 p-6 shadow-2xl">
        <div className="mb-6 flex items-start justify-between gap-4">
          <h2 id="board-settings-heading" className="text-lg font-semibold text-white">Board settings</h2>
          <button type="button" onClick={onClose} aria-label="Close settings" className="rounded px-2 text-2xl leading-none text-gray-400 hover:text-white">×</button>
        </div>

        <section aria-labelledby="members-heading">
          <h3 id="members-heading" className="mb-3 text-sm font-semibold text-gray-200">Members ({board.members.length})</h3>
          <ul className="space-y-3">
            {board.members.map((member) => (
              <MemberRow key={member.id} boardId={board.id} member={member} myRole={board.myRole} isMe={member.userId === me} />
            ))}
          </ul>
          {canManage && <AddMemberForm boardId={board.id} myRole={board.myRole} />}
          {!canManage && <p className="mt-4 text-xs text-gray-500">Only the owner and admins can change who is on this board.</p>}
        </section>
      </div>
    </div>
  );
}

function MemberRow({ boardId, member, myRole, isMe }: { boardId: string; member: BoardMemberDto; myRole: BoardRole; isMe: boolean }) {
  const [pending, setPending] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const manageable = canManageMember(myRole, member.role); // false for yourself, equals and above (and so for the owner)
  const options = rolesBelow(myRole);

  async function run(action: () => Promise<void>, fallback: string) {
    setPending(true);
    setError(null);
    try {
      await action();
    } catch (e) {
      setError(getErrorMessage(e, fallback));
      setConfirming(false);
    } finally {
      setPending(false);
    }
  }

  return (
    <li className="rounded border border-gray-800 bg-gray-950/60 p-3">
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold text-white">{member.user.name}{isMe ? " (you)" : ""}</p>
          <p className="truncate text-xs text-gray-400">{member.user.email}</p>
        </div>

        {manageable ? (
          <>
            <label htmlFor={`role-${member.id}`} className="sr-only">Role of {member.user.name}</label>
            <select
              id={`role-${member.id}`}
              value={member.role}
              disabled={pending}
              onChange={(e) => void run(() => changeMemberRole(boardId, member.id, e.target.value as AssignableRole), "Couldn't change the role.")}
              className="rounded border border-gray-700 bg-gray-900 px-2 py-1 text-sm text-gray-100 disabled:opacity-60"
            >
              {options.map((role) => <option key={role} value={role}>{ROLE_LABEL[role]}</option>)}
            </select>
          </>
        ) : (
          <span className="rounded bg-gray-800 px-2 py-1 text-xs text-gray-300">{ROLE_LABEL[member.role]}</span>
        )}
      </div>

      {manageable && !confirming && (
        <button type="button" disabled={pending} onClick={() => setConfirming(true)} aria-label={`Remove ${member.user.name}`} className="mt-2 text-xs text-gray-400 hover:text-red-400 disabled:opacity-50">
          Remove from board
        </button>
      )}

      {confirming && (
        <div role="alertdialog" aria-label={`Confirm removing ${member.user.name}`} className="mt-2 rounded border border-red-500/50 bg-red-950/40 p-2 text-xs text-red-100">
          <p>Remove {member.user.name}? They lose access immediately and their tasks become unassigned.</p>
          <div className="mt-2 flex gap-2">
            <button type="button" disabled={pending} onClick={() => void run(() => removeMember(boardId, member.id), "Couldn't remove the member.")} className="rounded bg-red-600 px-3 py-1 font-semibold text-white hover:bg-red-500 disabled:opacity-50">
              {pending ? "Removing…" : "Remove"}
            </button>
            <button type="button" disabled={pending} onClick={() => setConfirming(false)} className="rounded border border-gray-600 px-3 py-1 text-gray-200 hover:bg-gray-800">Cancel</button>
          </div>
        </div>
      )}

      {error && <p role="alert" className="mt-2 text-xs text-red-400">{error}</p>}
    </li>
  );
}

function AddMemberForm({ boardId, myRole }: { boardId: string; myRole: BoardRole }) {
  const options = rolesBelow(myRole);
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<AssignableRole>(options.includes("MEMBER") ? "MEMBER" : options[0]);
  const [pending, setPending] = useState(false);
  const [emailError, setEmailError] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [added, setAdded] = useState<string | null>(null);

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    const trimmed = email.trim();
    if (!trimmed || pending) return;
    setPending(true);
    setEmailError(null);
    setFormError(null);
    setAdded(null);
    try {
      await addMember(boardId, trimmed, role);
      setAdded(trimmed);
      setEmail("");
    } catch (error) {
      const fields = getFieldErrors(error);
      if (fields.email) setEmailError(fields.email);
      else if (error instanceof ApiError && (error.code === "USER_NOT_FOUND" || error.code === "ALREADY_MEMBER")) setEmailError(error.message);
      else setFormError(getErrorMessage(error, "Couldn't add the member."));
    } finally {
      setPending(false);
    }
  }

  return (
    <form onSubmit={onSubmit} noValidate className="mt-6 border-t border-gray-800 pt-4">
      <h4 className="mb-2 text-sm font-semibold text-gray-200">Add a member</h4>
      <label htmlFor="member-email" className="mb-1 block text-xs text-gray-400">Email of a registered user</label>
      <input id="member-email" type="email" value={email} placeholder="rahul@example.com" onChange={(e) => { setEmail(e.target.value); setEmailError(null); setAdded(null); }} aria-invalid={!!emailError} aria-describedby={emailError ? "member-email-error" : undefined} className={inputClass} />
      {emailError && <p id="member-email-error" role="alert" className="mt-1 text-xs text-red-400">{emailError}</p>}

      <label htmlFor="member-role" className="mb-1 mt-3 block text-xs text-gray-400">Role</label>
      <select id="member-role" value={role} onChange={(e) => setRole(e.target.value as AssignableRole)} className={inputClass}>
        {options.map((r) => <option key={r} value={r}>{ROLE_LABEL[r]}</option>)}
      </select>

      {formError && <p role="alert" className="mt-2 text-xs text-red-400">{formError}</p>}
      <div className="mt-3 flex items-center gap-3">
        <button type="submit" disabled={!email.trim() || pending} className="rounded bg-rose-600 px-4 py-1.5 text-sm font-semibold text-white hover:bg-rose-500 disabled:cursor-not-allowed disabled:opacity-50">
          {pending ? "Adding…" : "Add member"}
        </button>
        <span role="status" className="text-xs text-emerald-400">{added ? `Added ${added}` : ""}</span>
      </div>
    </form>
  );
}
