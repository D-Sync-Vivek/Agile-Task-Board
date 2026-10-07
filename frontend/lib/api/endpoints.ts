import type {
  ApiUser,
  BoardDetail,
  BoardSummary,
  ColumnDto,
  CommentDto,
  CreateBoardInput,
  CreateTaskInput,
  LoginInput,
  MoveTaskInput,
  MoveTaskResult,
  RegisterInput,
  TaskDetailDto,
  TaskDto,
  UpdateBoardInput,
  UpdateTaskInput,
} from "@/types/api";
import type { ApiClient, RequestOptions } from "./client";

const id = encodeURIComponent;

/** One function per backend endpoint. No state, no UI: stores/components call these. */
export function createApi(client: ApiClient) {
  return {
    auth: {
      register: (input: RegisterInput) => client.post<{ user: ApiUser }>("/api/auth/register", input),
      login: (input: LoginInput) => client.post<{ user: ApiUser }>("/api/auth/login", input),
      logout: () => client.post<null>("/api/auth/logout"),
      me: (options?: RequestOptions) => client.get<{ user: ApiUser }>("/api/auth/me", options),
    },

    boards: {
      list: (options?: RequestOptions) => client.get<{ boards: BoardSummary[] }>("/api/boards", options),
      create: (input: CreateBoardInput) => client.post<{ board: BoardSummary }>("/api/boards", input),
      get: (boardId: string, options?: RequestOptions) => client.get<{ board: BoardDetail }>(`/api/boards/${id(boardId)}`, options),
      update: (boardId: string, input: UpdateBoardInput) => client.patch<{ board: BoardSummary }>(`/api/boards/${id(boardId)}`, input),
      delete: (boardId: string) => client.delete<null>(`/api/boards/${id(boardId)}`),
    },

    columns: {
      create: (boardId: string, input: { title: string }) => client.post<{ column: ColumnDto }>(`/api/boards/${id(boardId)}/columns`, input),
      rename: (columnId: string, input: { title: string }) => client.patch<{ column: ColumnDto }>(`/api/columns/${id(columnId)}`, input),
      delete: (columnId: string) => client.delete<null>(`/api/columns/${id(columnId)}`),
      /** `columnIds` must be the board's complete column list in the new order. */
      reorder: (boardId: string, columnIds: string[]) =>
        client.patch<{ columns: ColumnDto[] }>(`/api/boards/${id(boardId)}/columns/reorder`, { columnIds }),
    },

    tasks: {
      list: (boardId: string, options?: RequestOptions) => client.get<{ tasks: TaskDto[] }>(`/api/boards/${id(boardId)}/tasks`, options),
      create: (boardId: string, input: CreateTaskInput) => client.post<{ task: TaskDto }>(`/api/boards/${id(boardId)}/tasks`, input),
      get: (taskId: string, options?: RequestOptions) => client.get<{ task: TaskDetailDto }>(`/api/tasks/${id(taskId)}`, options),
      update: (taskId: string, input: UpdateTaskInput) => client.patch<{ task: TaskDto }>(`/api/tasks/${id(taskId)}`, input),
      delete: (taskId: string) => client.delete<null>(`/api/tasks/${id(taskId)}`),
      move: (taskId: string, input: MoveTaskInput) => client.patch<MoveTaskResult>(`/api/tasks/${id(taskId)}/move`, input),
      assign: (taskId: string, assigneeId: string | null) => client.patch<{ task: TaskDto }>(`/api/tasks/${id(taskId)}/assign`, { assigneeId }),
    },

    comments: {
      list: (taskId: string, options?: RequestOptions) => client.get<{ comments: CommentDto[] }>(`/api/tasks/${id(taskId)}/comments`, options),
      create: (taskId: string, input: { content: string }) => client.post<{ comment: CommentDto }>(`/api/tasks/${id(taskId)}/comments`, input),
      update: (commentId: string, input: { content: string }) => client.patch<{ comment: CommentDto }>(`/api/comments/${id(commentId)}`, input),
      delete: (commentId: string) => client.delete<null>(`/api/comments/${id(commentId)}`),
    },
  };
}

export type Api = ReturnType<typeof createApi>;
