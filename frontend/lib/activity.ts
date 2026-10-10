import { formatDueDate } from "@/lib/dates";
import type { ActivityDto, BoardRole, TaskPriority } from "@/types/api";

const PRIORITY: Record<TaskPriority, string> = { LOW: "Low", MEDIUM: "Medium", HIGH: "High", URGENT: "Urgent" };
const ROLE: Record<BoardRole, string> = { OWNER: "Owner", ADMIN: "Admin", MEMBER: "Member", VIEWER: "Viewer" };

// The log stores SNAPSHOTS (titles, names), so text can be built even when the thing no longer exists. Values are
// still read defensively: an entry written by an older/newer server must never crash the feed.
const q = (value: string | undefined) => `“${value ?? "a task"}”`;
const priority = (value: TaskPriority) => PRIORITY[value] ?? value;
const role = (value: BoardRole) => ROLE[value] ?? value;
const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

/** Who did it: "You" for the signed-in user, otherwise their name. */
export function actorName(entry: ActivityDto, currentUserId: string | undefined): string {
  return entry.actor.id === currentUserId ? "You" : entry.actor.name;
}

/** The sentence after the actor's name, e.g. `moved “Dashboard UI” from Todo to Doing`. */
export function describeActivity(entry: ActivityDto): string {
  switch (entry.action) {
    case "TASK_CREATED":
      return `created task ${q(entry.metadata.taskTitle)} in ${entry.metadata.columnTitle}`;

    case "TASK_UPDATED": {
      const { changes } = entry.metadata;
      const parts: string[] = [];
      if (changes.title) parts.push(`renamed from ${q(changes.title.from)}`);
      if (changes.priority) parts.push(`priority ${priority(changes.priority.from)} → ${priority(changes.priority.to)}`);
      if (changes.dueDate) {
        parts.push(changes.dueDate.to ? `due date → ${formatDueDate(changes.dueDate.to)}` : "due date removed");
      }
      if (changes.description) parts.push("description");
      return parts.length > 0 ? `updated ${q(entry.metadata.taskTitle)} (${parts.join(", ")})` : `updated ${q(entry.metadata.taskTitle)}`;
    }

    case "TASK_DELETED":
      return `deleted task ${q(entry.metadata.taskTitle)} from ${entry.metadata.columnTitle}`;

    case "TASK_MOVED":
      return `moved ${q(entry.metadata.taskTitle)} from ${entry.metadata.fromColumn.title} to ${entry.metadata.toColumn.title}`;

    case "TASK_ASSIGNED": {
      const { taskTitle, from, to } = entry.metadata;
      if (to && from) return `reassigned ${q(taskTitle)} from ${from.name} to ${to.name}`;
      if (to) return `assigned ${q(taskTitle)} to ${to.name}`;
      return from ? `unassigned ${q(taskTitle)} (was ${from.name})` : `unassigned ${q(taskTitle)}`;
    }

    case "COLUMN_CREATED":
      return `added column “${entry.metadata.columnTitle}”`;
    case "COLUMN_RENAMED":
      return `renamed column “${entry.metadata.from}” to “${entry.metadata.to}”`;
    case "COLUMN_DELETED": {
      const { columnTitle, taskCount } = entry.metadata;
      return taskCount > 0 ? `deleted column “${columnTitle}” and its ${plural(taskCount, "task")}` : `deleted column “${columnTitle}”`;
    }

    case "MEMBER_ADDED":
      return `added ${entry.metadata.memberName} as ${role(entry.metadata.role)}`;
    case "MEMBER_ROLE_CHANGED":
      return `changed ${entry.metadata.memberName} from ${role(entry.metadata.from)} to ${role(entry.metadata.to)}`;
    case "MEMBER_REMOVED":
      return `removed ${entry.metadata.memberName} from the board`;

    case "COMMENT_ADDED":
      return `commented on ${q(entry.metadata.taskTitle)}`;

    default:
      return "did something"; // an action this client doesn't know yet
  }
}
