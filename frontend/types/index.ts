import type { ColumnDto, TaskDto } from "@/types/api";

// The UI works with the same shapes the backend returns, so there is no mapping layer to drift out of sync.
// Ids are server-generated strings.
export type Id = string;
export type Task = TaskDto;
export type Column = ColumnDto;
