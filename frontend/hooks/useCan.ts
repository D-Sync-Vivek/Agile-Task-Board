import { useBoardStore } from "@/store/useBoardStore";
import type { Permission } from "@/types/api";

/** Whether the signed-in user may do `permission` on the open board. UI convenience only; the backend enforces it. */
export function useCan(permission: Permission): boolean {
  return useBoardStore((state) => state.board?.myPermissions.includes(permission) ?? false);
}
