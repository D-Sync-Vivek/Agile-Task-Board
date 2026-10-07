"use client";
import { useEffect, useRef, useState } from "react";
import type { KeyboardEvent } from "react";
import { useCan } from "@/hooks/useCan";
import { useNow } from "@/hooks/useNow";
import { formatRelativeTime, formatTimestamp } from "@/lib/dates";
import { getErrorMessage } from "@/lib/errors";
import { useAuthStore } from "@/store/useAuthStore";
import { useCommentStore } from "@/store/useCommentStore";
import type { CommentView } from "@/store/useCommentStore";

const MAX_LENGTH = 5000;
const textareaClass = "w-full resize-y rounded border border-gray-700 bg-gray-950 px-3 py-2 text-sm text-white placeholder-gray-500 focus:border-rose-500 focus:outline-none";

interface Props {
  taskId: string;
  /** Tells the panel whether there is an unsent comment, so closing it can warn instead of silently losing it. */
  onDraftChange: (hasDraft: boolean) => void;
}

export default function CommentsSection({ taskId, onDraftChange }: Props) {
  const comments = useCommentStore((s) => s.comments);
  const status = useCommentStore((s) => s.status);
  const error = useCommentStore((s) => s.error);
  const load = useCommentStore((s) => s.load);
  const reset = useCommentStore((s) => s.reset);
  const add = useCommentStore((s) => s.add);
  const canComment = useCan("comment:create");
  const canModerate = useCan("comment:moderate");
  const me = useAuthStore((s) => s.user?.id);
  const now = useNow();

  const [text, setText] = useState("");
  const [postError, setPostError] = useState<string | null>(null);
  const composerRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    const controller = new AbortController();
    void load(taskId, { signal: controller.signal });
    return () => {
      controller.abort();
      reset();
    };
  }, [taskId, load, reset]);

  useEffect(() => {
    onDraftChange(text.trim().length > 0);
  }, [text, onDraftChange]);

  async function post() {
    const content = text.trim();
    if (!content) return;
    setText(""); // the comment appears immediately (optimistic), so the box empties immediately
    composerRef.current?.focus(); // keep the keyboard where the user is typing (the Comment button disables itself)
    setPostError(null);
    try {
      await add(taskId, content);
    } catch (e) {
      setText((current) => current || content); // never lose what the user wrote
      setPostError(getErrorMessage(e, "Couldn't post your comment."));
    }
  }

  function onComposerKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) {
      event.preventDefault();
      void post();
    }
  }

  return (
    <section aria-labelledby="comments-heading" className="mt-8 border-t border-gray-800 pt-4">
      <h3 id="comments-heading" className="mb-3 text-sm font-semibold text-gray-200">
        Comments{status === "ready" ? ` (${comments.length})` : ""}
      </h3>

      {status === "loading" && <p role="status" className="text-sm text-gray-400">Loading comments…</p>}

      {status === "error" && (
        <div role="alert" className="flex items-center gap-3 text-sm text-gray-300">
          <span>{error ?? "Unable to load comments."}</span>
          <button type="button" onClick={() => void load(taskId)} className="rounded bg-gray-800 px-3 py-1 hover:bg-gray-700">Retry</button>
        </div>
      )}

      {status === "ready" && comments.length === 0 && <p className="text-sm text-gray-500">No comments yet.</p>}

      {status === "ready" && comments.length > 0 && (
        <ul className="space-y-4">
          {comments.map((comment) => (
            <CommentItem key={comment.id} comment={comment} now={now} isMine={comment.userId === me} canEdit={canComment && comment.userId === me} canDelete={comment.userId === me || canModerate} />
          ))}
        </ul>
      )}

      {status === "ready" && canComment && (
        <div className="mt-4">
          <label htmlFor="new-comment" className="sr-only">Write a comment</label>
          <textarea
            id="new-comment"
            ref={composerRef}
            value={text}
            rows={3}
            maxLength={MAX_LENGTH}
            placeholder="Write a comment…"
            onChange={(e) => {
              setText(e.target.value);
              setPostError(null);
            }}
            onKeyDown={onComposerKeyDown}
            className={textareaClass}
          />
          {postError && <p role="alert" className="mt-1 text-xs text-red-400">{postError}</p>}
          <div className="mt-2 flex items-center justify-between">
            <span className="text-xs text-gray-500">Ctrl/⌘ + Enter to send</span>
            <button type="button" onClick={() => void post()} disabled={!text.trim()} className="rounded bg-rose-600 px-4 py-1.5 text-sm font-semibold text-white hover:bg-rose-500 disabled:cursor-not-allowed disabled:opacity-50">
              Comment
            </button>
          </div>
        </div>
      )}
    </section>
  );
}

function CommentItem({ comment, now, isMine, canEdit, canDelete }: { comment: CommentView; now: number; isMine: boolean; canEdit: boolean; canDelete: boolean }) {
  const edit = useCommentStore((s) => s.edit);
  const remove = useCommentStore((s) => s.remove);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");

  const actionable = !comment.pending; // a comment without a server id can't be edited or deleted yet

  function startEdit() {
    setDraft(comment.content);
    setEditing(true);
  }

  function saveEdit() {
    setEditing(false); // optimistic: the new text shows at once, the store rolls back if the server refuses
    void edit(comment.id, draft);
  }

  function onEditKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === "Escape") {
      event.stopPropagation(); // cancel the edit only; don't close the whole panel
      setEditing(false);
    } else if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) {
      event.preventDefault();
      if (draft.trim()) saveEdit();
    }
  }

  return (
    <li className={comment.pending ? "opacity-60" : undefined}>
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-sm font-semibold text-white">{isMine ? `${comment.author.name} (you)` : comment.author.name}</span>
        <span className="text-xs text-gray-500" title={formatTimestamp(comment.createdAt)}>
          {comment.pending ? "Sending…" : formatRelativeTime(comment.createdAt, now)}
          {comment.edited && !comment.pending ? " · edited" : ""}
        </span>
      </div>

      {editing ? (
        <div className="mt-1">
          <label htmlFor={`edit-${comment.id}`} className="sr-only">Edit comment</label>
          <textarea id={`edit-${comment.id}`} autoFocus value={draft} rows={3} maxLength={MAX_LENGTH} onChange={(e) => setDraft(e.target.value)} onKeyDown={onEditKeyDown} className={textareaClass} />
          <div className="mt-2 flex gap-2">
            <button type="button" onClick={saveEdit} disabled={!draft.trim()} className="rounded bg-rose-600 px-3 py-1 text-xs font-semibold text-white hover:bg-rose-500 disabled:opacity-50">Save</button>
            <button type="button" onClick={() => setEditing(false)} className="rounded border border-gray-700 px-3 py-1 text-xs text-gray-200 hover:bg-gray-800">Cancel</button>
          </div>
        </div>
      ) : (
        <p className="mt-1 whitespace-pre-wrap break-words text-sm text-gray-200">{comment.content}</p>
      )}

      {actionable && !editing && (canEdit || canDelete) && (
        <div className="mt-1 flex gap-3 text-xs">
          {canEdit && (
            <button type="button" onClick={startEdit} aria-label={`Edit comment by ${comment.author.name}`} className="text-gray-400 hover:text-white">Edit</button>
          )}
          {canDelete && (
            <button type="button" onClick={() => void remove(comment.id)} aria-label={`Delete comment by ${comment.author.name}`} className="text-gray-400 hover:text-red-400">Delete</button>
          )}
        </div>
      )}
    </li>
  );
}
