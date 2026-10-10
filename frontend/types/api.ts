// Shapes returned by the backend REST API (see backend/src/services/*). Dates are ISO strings;
// a task's dueDate is a calendar date "YYYY-MM-DD".

export type BoardRole = "OWNER" | "ADMIN" | "MEMBER" | "VIEWER";
export type TaskPriority = "LOW" | "MEDIUM" | "HIGH" | "URGENT";
export type Permission =
  | "board:view"
  | "board:update"
  | "board:delete"
  | "member:manage"
  | "column:create"
  | "column:update"
  | "column:delete"
  | "task:create"
  | "task:update"
  | "task:move"
  | "task:delete"
  | "comment:create"
  | "comment:moderate";

export interface ApiUser {
  id: string;
  name: string;
  email: string;
  avatar: string | null;
  createdAt: string;
}

export interface ApiUserSummary {
  id: string;
  name: string;
  avatar: string | null;
}

export interface BoardSummary {
  id: string;
  name: string;
  description: string | null;
  ownerId: string;
  createdAt: string;
  updatedAt: string;
  myRole: BoardRole;
  memberCount: number;
  taskCount: number;
}

export interface ColumnDto {
  id: string;
  boardId: string;
  title: string;
  position: number;
  createdAt: string;
  updatedAt: string;
}

export interface TaskDto {
  id: string;
  boardId: string;
  columnId: string;
  title: string;
  description: string | null;
  priority: TaskPriority;
  assigneeId: string | null;
  createdById: string;
  position: number;
  dueDate: string | null;
  createdAt: string;
  updatedAt: string;
}

/** GET /api/tasks/:id additionally includes who created / is assigned the task. */
export interface TaskDetailDto extends TaskDto {
  createdBy: ApiUserSummary;
  assignee: ApiUserSummary | null;
}

export interface CommentDto {
  id: string;
  taskId: string;
  userId: string;
  content: string;
  createdAt: string;
  updatedAt: string;
  /** True once the text was changed after posting. */
  edited: boolean;
  author: ApiUserSummary;
}

export interface BoardMemberDto {
  id: string;
  userId: string;
  role: BoardRole;
  createdAt: string;
  user: Pick<ApiUser, "id" | "name" | "email" | "avatar">;
}

export interface BoardDetail {
  id: string;
  name: string;
  description: string | null;
  ownerId: string;
  createdAt: string;
  updatedAt: string;
  myRole: BoardRole;
  /** What the caller may do on this board (from the backend's single permission matrix). */
  myPermissions: Permission[];
  members: BoardMemberDto[];
  columns: ColumnDto[];
  tasks: TaskDto[];
}

// ───────────── Activity (GET /api/boards/:id/activity, GET /api/tasks/:id/activity) ─────────────
// `metadata` is a snapshot taken when the event happened (titles / names), so an entry still reads correctly after
// the task, column or user it mentions is renamed or deleted. Its shape depends on `action`.
type ColumnRef = { id: string; title: string };
type PersonRef = { id: string; name: string };

export interface TaskFieldChanges {
  title?: { from: string; to: string };
  priority?: { from: TaskPriority; to: TaskPriority };
  dueDate?: { from: string | null; to: string | null };
  /** Only the fact that it changed; the text itself is not stored in the log. */
  description?: true;
}

export type ActivityEvent =
  | { action: "TASK_CREATED"; entityType: "TASK"; metadata: { taskTitle: string; columnTitle: string } }
  | { action: "TASK_UPDATED"; entityType: "TASK"; metadata: { taskTitle: string; changes: TaskFieldChanges } }
  | { action: "TASK_DELETED"; entityType: "TASK"; metadata: { taskTitle: string; columnTitle: string } }
  | { action: "TASK_MOVED"; entityType: "TASK"; metadata: { taskTitle: string; fromColumn: ColumnRef; toColumn: ColumnRef } }
  | { action: "TASK_ASSIGNED"; entityType: "TASK"; metadata: { taskTitle: string; from: PersonRef | null; to: PersonRef | null } }
  | { action: "COLUMN_CREATED"; entityType: "COLUMN"; metadata: { columnTitle: string } }
  | { action: "COLUMN_RENAMED"; entityType: "COLUMN"; metadata: { from: string; to: string } }
  | { action: "COLUMN_DELETED"; entityType: "COLUMN"; metadata: { columnTitle: string; taskCount: number } }
  | { action: "MEMBER_ADDED"; entityType: "MEMBER"; metadata: { memberName: string; role: BoardRole } }
  | { action: "MEMBER_ROLE_CHANGED"; entityType: "MEMBER"; metadata: { memberName: string; from: BoardRole; to: BoardRole } }
  | { action: "MEMBER_REMOVED"; entityType: "MEMBER"; metadata: { memberName: string } }
  | { action: "COMMENT_ADDED"; entityType: "COMMENT"; metadata: { taskId: string; taskTitle: string } };

export type ActivityAction = ActivityEvent["action"];

export type ActivityDto = ActivityEvent & {
  id: string;
  boardId: string;
  entityId: string;
  createdAt: string;
  actor: ApiUserSummary;
};

/** Newest first. `nextCursor` is null on the last page; pass it back as `cursor` to get the next one. */
export interface ActivityPage {
  activities: ActivityDto[];
  nextCursor: string | null;
}

export interface ActivityPageParams {
  limit?: number;
  cursor?: string;
}

/** Result of PATCH /api/tasks/:id/move: the task plus the new task order of each affected column. */
export interface MoveTaskResult {
  task: TaskDto;
  columns: { columnId: string; taskIds: string[] }[];
}

// Request bodies
export interface RegisterInput {
  name: string;
  email: string;
  password: string;
}
export interface LoginInput {
  email: string;
  password: string;
}
export interface CreateBoardInput {
  name: string;
  description?: string | null;
}
export type UpdateBoardInput = Partial<CreateBoardInput>;
export interface CreateTaskInput {
  title: string;
  columnId: string;
  description?: string | null;
  priority?: TaskPriority;
  assigneeId?: string | null;
  dueDate?: string | null;
}
export interface UpdateTaskInput {
  title?: string;
  description?: string | null;
  priority?: TaskPriority;
  dueDate?: string | null;
}
export interface MoveTaskInput {
  columnId: string;
  position: number;
}
