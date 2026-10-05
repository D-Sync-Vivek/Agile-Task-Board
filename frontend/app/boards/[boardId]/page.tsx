"use client";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect } from "react";
import AppHeader from "@/components/AppHeader";
import KanbanBoard from "@/components/Kanban/KanbanBoard";
import PageMessage from "@/components/ui/PageMessage";
import { useRequireAuth } from "@/hooks/useRequireAuth";
import { useAuthStore } from "@/store/useAuthStore";
import { useBoardStore } from "@/store/useBoardStore";

const ROLE_LABEL = { OWNER: "Owner", ADMIN: "Admin", MEMBER: "Member", VIEWER: "Viewer (read-only)" } as const;

export default function BoardPage() {
  const { boardId } = useParams<{ boardId: string }>();
  const authStatus = useRequireAuth();
  const fetchSession = useAuthStore((state) => state.fetchSession);
  const status = useBoardStore((state) => state.status);
  const error = useBoardStore((state) => state.error);
  const board = useBoardStore((state) => state.board);
  const loadBoard = useBoardStore((state) => state.loadBoard);

  // Load on entry, cancel the in-flight request when leaving or switching boards.
  useEffect(() => {
    if (authStatus !== "authenticated") return;
    const controller = new AbortController();
    void loadBoard(boardId, { signal: controller.signal });
    return () => controller.abort();
  }, [authStatus, boardId, loadBoard]);

  if (authStatus === "error") {
    return (
      <main className="flex h-screen flex-col bg-gray-950">
        <PageMessage role="alert">
          <p>Unable to reach the server.</p>
          <button onClick={() => void fetchSession()} className="rounded bg-rose-600 px-4 py-2 text-white hover:bg-rose-500">Retry</button>
        </PageMessage>
      </main>
    );
  }

  const showBoard = authStatus === "authenticated" && board?.id === boardId && status !== "error";

  return (
    <main className="flex h-screen flex-col overflow-hidden bg-gray-950">
      {authStatus === "authenticated" && (
        <AppHeader title={showBoard && board ? board.name : "Board"} subtitle={showBoard && board ? `Your role: ${ROLE_LABEL[board.myRole]}` : undefined} backHref="/" />
      )}

      {authStatus !== "authenticated" && <PageMessage role="status">Loading…</PageMessage>}

      {authStatus === "authenticated" && status === "error" && (
        <PageMessage role="alert">
          {error?.status === 404 || error?.status === 403 ? (
            <>
              <p>Board not found.</p>
              <Link href="/" className="rounded bg-gray-800 px-4 py-2 text-white hover:bg-gray-700">Back to my boards</Link>
            </>
          ) : (
            <>
              <p>Unable to load this board.</p>
              <button onClick={() => void loadBoard(boardId)} className="rounded bg-rose-600 px-4 py-2 text-white hover:bg-rose-500">Retry</button>
            </>
          )}
        </PageMessage>
      )}

      {authStatus === "authenticated" && status !== "error" && !showBoard && <PageMessage role="status">Loading board…</PageMessage>}

      {showBoard && (
        <div className="flex-1 overflow-x-auto overflow-y-hidden bg-gray-950 p-6">
          <div className="h-full min-w-fit">
            <KanbanBoard />
          </div>
        </div>
      )}
    </main>
  );
}
