"use client";
import { useEffect, useRef, useState } from "react";
import type { FormEvent, KeyboardEvent } from "react";
import { useCan } from "@/hooks/useCan";
import { formatDueDate, formatTimestamp } from "@/lib/dates";
import { ApiError } from "@/lib/api/client";
import { getErrorMessage, getFieldErrors } from "@/lib/errors";
import { useBoardStore } from "@/store/useBoardStore";
import type { TaskDetailsChanges } from "@/store/useBoardStore";
import { useTaskPanelStore } from "@/store/useTaskPanelStore";
import type { Task } from "@/types";
import type { TaskPriority } from "@/types/api";

const PRIORITIES: { value: TaskPriority; label: string; dot: string }[] = [
  { value: "LOW", label: "Low", dot: "bg-sky-400" },
  { value: "MEDIUM", label: "Medium", dot: "bg-yellow-400" },
  { value: "HIGH", label: "High", dot: "bg-orange-500" },
  { value: "URGENT", label: "Urgent", dot: "bg-red-500" },
];

interface Draft {
  title: string;
  description: string;
  priority: TaskPriority;
  dueDate: string; // "" = none
  assigneeId: string; // "" = unassigned
}

const toDraft = (task: Task): Draft => ({
  title: task.title,
  description: task.description ?? "",
  priority: task.priority,
  dueDate: task.dueDate ?? "",
  assigneeId: task.assigneeId ?? "",
});

/** Only the fields that differ from the saved task, in API shape (blank description/date/assignee -> null). */
function diff(draft: Draft, task: Task): TaskDetailsChanges {
  const changes: TaskDetailsChanges = {};
  const title = draft.title.trim();
  const description = draft.description.trim() || null;
  const dueDate = draft.dueDate || null;
  const assigneeId = draft.assigneeId || null;
  if (title !== task.title) changes.title = title;
  if (description !== task.description) changes.description = description;
  if (draft.priority !== task.priority) changes.priority = draft.priority;
  if (dueDate !== task.dueDate) changes.dueDate = dueDate;
  if (assigneeId !== task.assigneeId) changes.assigneeId = assigneeId;
  return changes;
}

const inputClass = "w-full rounded border border-gray-700 bg-gray-950 px-3 py-2 text-white placeholder-gray-500 focus:border-rose-500 focus:outline-none disabled:opacity-60";

function Field({ id, label, error, children }: { id: string; label: string; error?: string; children: React.ReactNode }) {
  return (
    <div>
      <label htmlFor={id} className="mb-1 block text-sm text-gray-300">{label}</label>
      {children}
      {error && <p id={`${id}-error`} className="mt-1 text-xs text-red-400">{error}</p>}
    </div>
  );
}

/** Opens when a task card is clicked. Mount once inside the board page. */
export default function TaskDetailPanel() {
  const taskId = useTaskPanelStore((state) => state.taskId);
  const close = useTaskPanelStore((state) => state.close);
  const task = useBoardStore((state) => state.tasks.find((t) => t.id === taskId));

  // The task can disappear while the panel is open (deleted here or by someone else, or the board re-synced).
  useEffect(() => {
    if (taskId && !task) close();
  }, [taskId, task, close]);

  if (!taskId || !task) return null;
  return <PanelContent key={task.id} task={task} />; // new key per task => fresh form state
}

function PanelContent({ task }: { task: Task }) {
  const close = useTaskPanelStore((state) => state.close);
  const members = useBoardStore((state) => state.board?.members ?? []);
  const updateTaskDetails = useBoardStore((state) => state.updateTaskDetails);
  const canEdit = useCan("task:update");

  const [draft, setDraft] = useState<Draft>(() => toDraft(task));
  const [pending, setPending] = useState(false);
  const [saved, setSaved] = useState(false);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [confirmDiscard, setConfirmDiscard] = useState(false);

  const dialogRef = useRef<HTMLDivElement>(null);
  const changes = diff(draft, task);
  const dirty = Object.keys(changes).length > 0;

  const nameOf = (userId: string | null) => (userId ? (members.find((m) => m.userId === userId)?.user.name ?? "Former member") : null);

  // Focus management: move focus into the dialog, give it back to the card when closing.
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    dialogRef.current?.querySelector<HTMLElement>("input, textarea, select, button")?.focus();
    return () => {
      if (previous?.isConnected) previous.focus();
    };
  }, []);

  function update(patch: Partial<Draft>) {
    setDraft((d) => ({ ...d, ...patch }));
    setSaved(false);
    setConfirmDiscard(false);
  }

  function requestClose() {
    if (dirty && !confirmDiscard) {
      setConfirmDiscard(true); // first attempt warns, second discards
      return;
    }
    close();
  }

  function onKeyDown(event: KeyboardEvent) {
    if (event.key === "Escape") {
      event.stopPropagation();
      requestClose();
      return;
    }
    if (event.key !== "Tab" || !dialogRef.current) return;
    // Keep Tab inside the dialog.
    const focusable = Array.from(dialogRef.current.querySelectorAll<HTMLElement>("button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled])"));
    if (focusable.length === 0) return;
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  }

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    if (!canEdit || pending || !dirty) return;
    if (!draft.title.trim()) {
      setFieldErrors({ title: "Title is required" });
      return;
    }
    setPending(true);
    setFieldErrors({});
    setFormError(null);
    setSaved(false);
    try {
      await updateTaskDetails(task.id, changes);
      const latest = useBoardStore.getState().tasks.find((t) => t.id === task.id);
      if (latest) setDraft(toDraft(latest)); // show the saved (trimmed) values
      setSaved(true);
    } catch (error) {
      const fields = getFieldErrors(error);
      if (error instanceof ApiError && error.code === "INVALID_ASSIGNEE") fields.assigneeId = error.message;
      setFieldErrors(fields);
      setFormError(Object.keys(fields).length === 0 ? getErrorMessage(error, "Couldn't save the task.") : null);
    } finally {
      setPending(false);
    }
  }

  const priority = PRIORITIES.find((p) => p.value === task.priority) ?? PRIORITIES[1];
  const assigneeKnown = !draft.assigneeId || members.some((m) => m.userId === draft.assigneeId);

  return (
    <div className="fixed inset-0 z-40 flex justify-end">
      <div className="absolute inset-0 bg-black/60" aria-hidden="true" onClick={requestClose} />

      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="task-panel-heading"
        onKeyDown={onKeyDown}
        className="relative h-full w-full max-w-md overflow-y-auto border-l border-gray-800 bg-gray-900 p-6 shadow-2xl"
      >
        <div className="mb-4 flex items-start justify-between gap-4">
          <h2 id="task-panel-heading" className="text-lg font-semibold text-white">Task details</h2>
          <button type="button" onClick={requestClose} aria-label="Close task details" className="rounded px-2 text-2xl leading-none text-gray-400 hover:text-white">×</button>
        </div>

        {confirmDiscard && (
          <p role="alert" className="mb-4 rounded border border-yellow-500/60 bg-yellow-950 px-3 py-2 text-sm text-yellow-100">
            You have unsaved changes. Close again to discard them, or save first.
          </p>
        )}
        {formError && (
          <p role="alert" className="mb-4 rounded border border-red-500/60 bg-red-950 px-3 py-2 text-sm text-red-100">{formError}</p>
        )}

        {canEdit ? (
          <form onSubmit={onSubmit} noValidate className="space-y-4">
            <Field id="task-title" label="Title" error={fieldErrors.title}>
              <input id="task-title" value={draft.title} maxLength={200} onChange={(e) => update({ title: e.target.value })} className={inputClass} aria-invalid={!!fieldErrors.title} aria-describedby={fieldErrors.title ? "task-title-error" : undefined} />
            </Field>

            <Field id="task-description" label="Description" error={fieldErrors.description}>
              <textarea id="task-description" value={draft.description} rows={5} onChange={(e) => update({ description: e.target.value })} className={`${inputClass} resize-y`} aria-invalid={!!fieldErrors.description} />
            </Field>

            <div className="grid grid-cols-2 gap-4">
              <Field id="task-priority" label="Priority" error={fieldErrors.priority}>
                <select id="task-priority" value={draft.priority} onChange={(e) => update({ priority: e.target.value as TaskPriority })} className={inputClass}>
                  {PRIORITIES.map((p) => <option key={p.value} value={p.value}>{p.label}</option>)}
                </select>
              </Field>

              <Field id="task-due" label="Due date" error={fieldErrors.dueDate}>
                <div className="flex gap-2">
                  <input id="task-due" type="date" value={draft.dueDate} onChange={(e) => update({ dueDate: e.target.value })} className={inputClass} aria-invalid={!!fieldErrors.dueDate} />
                  {draft.dueDate && (
                    <button type="button" onClick={() => update({ dueDate: "" })} aria-label="Clear due date" className="rounded border border-gray-700 px-2 text-gray-300 hover:bg-gray-800">×</button>
                  )}
                </div>
              </Field>
            </div>

            <Field id="task-assignee" label="Assignee" error={fieldErrors.assigneeId}>
              <select id="task-assignee" value={draft.assigneeId} onChange={(e) => update({ assigneeId: e.target.value })} className={inputClass}>
                <option value="">Unassigned</option>
                {!assigneeKnown && <option value={draft.assigneeId}>Former member</option>}
                {members.map((m) => <option key={m.userId} value={m.userId}>{m.user.name}</option>)}
              </select>
            </Field>

            <div className="flex items-center gap-3 pt-2">
              <button type="submit" disabled={!dirty || pending} className="rounded bg-rose-600 px-4 py-2 font-semibold text-white hover:bg-rose-500 disabled:cursor-not-allowed disabled:opacity-50">
                {pending ? "Saving…" : "Save changes"}
              </button>
              <button type="button" disabled={!dirty || pending} onClick={() => { setDraft(toDraft(task)); setFieldErrors({}); setFormError(null); setConfirmDiscard(false); }} className="rounded border border-gray-700 px-4 py-2 text-gray-200 hover:bg-gray-800 disabled:opacity-50">
                Reset
              </button>
              <span role="status" className="text-sm text-emerald-400">{saved ? "Saved" : ""}</span>
            </div>
          </form>
        ) : (
          <dl className="space-y-4 text-sm">
            <div>
              <dt className="text-gray-400">Title</dt>
              <dd className="mt-1 whitespace-pre-wrap text-base text-white">{task.title}</dd>
            </div>
            <div>
              <dt className="text-gray-400">Description</dt>
              <dd className={`mt-1 whitespace-pre-wrap ${task.description ? "text-gray-100" : "text-gray-500"}`}>{task.description ?? "No description"}</dd>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <dt className="text-gray-400">Priority</dt>
                <dd className="mt-1 flex items-center gap-2 text-gray-100"><span className={`inline-block h-2.5 w-2.5 rounded-full ${priority.dot}`} />{priority.label}</dd>
              </div>
              <div>
                <dt className="text-gray-400">Due date</dt>
                <dd className="mt-1 text-gray-100">{task.dueDate ? formatDueDate(task.dueDate) : "No due date"}</dd>
              </div>
            </div>
            <div>
              <dt className="text-gray-400">Assignee</dt>
              <dd className="mt-1 text-gray-100">{nameOf(task.assigneeId) ?? "Unassigned"}</dd>
            </div>
          </dl>
        )}

        <dl className="mt-8 space-y-2 border-t border-gray-800 pt-4 text-xs text-gray-400">
          <div className="flex justify-between gap-4"><dt>Created by</dt><dd className="text-gray-200">{nameOf(task.createdById)}</dd></div>
          <div className="flex justify-between gap-4"><dt>Created</dt><dd className="text-gray-200">{formatTimestamp(task.createdAt)}</dd></div>
          <div className="flex justify-between gap-4"><dt>Last updated</dt><dd className="text-gray-200">{formatTimestamp(task.updatedAt)}</dd></div>
        </dl>
      </div>
    </div>
  );
}
