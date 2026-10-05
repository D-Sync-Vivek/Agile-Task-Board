"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import type { FormEvent } from "react";
import AppHeader from "@/components/AppHeader";
import PageMessage from "@/components/ui/PageMessage";
import { useRequireAuth } from "@/hooks/useRequireAuth";
import { getErrorMessage } from "@/lib/errors";
import { useAuthStore } from "@/store/useAuthStore";
import { useBoardListStore } from "@/store/useBoardListStore";

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

export default function DashboardPage() {
  const router = useRouter();
  const authStatus = useRequireAuth();
  const fetchSession = useAuthStore((state) => state.fetchSession);
  const { boards, status, error, load, createBoard } = useBoardListStore();

  const [name, setName] = useState("");
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);

  useEffect(() => {
    if (authStatus !== "authenticated") return;
    const controller = new AbortController();
    void load(controller.signal);
    return () => controller.abort();
  }, [authStatus, load]);

  async function handleCreate(event: FormEvent) {
    event.preventDefault();
    if (!name.trim() || creating) return;
    setCreating(true);
    setCreateError(null);
    try {
      const board = await createBoard(name);
      router.push(`/boards/${board.id}`);
    } catch (e) {
      setCreateError(getErrorMessage(e, "Couldn't create the board."));
      setCreating(false);
    }
  }

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
  if (authStatus !== "authenticated") {
    return (
      <main className="flex h-screen flex-col bg-gray-950">
        <PageMessage role="status">Loading…</PageMessage>
      </main>
    );
  }

  return (
    <main className="flex h-screen flex-col overflow-hidden bg-gray-950">
      <AppHeader title="My Boards" subtitle="Pick a board or start a new one." />

      <div className="flex-1 overflow-y-auto p-6">
        <div className="mx-auto max-w-4xl space-y-6">
          <form onSubmit={handleCreate} className="flex flex-col gap-2 sm:flex-row">
            <input
              aria-label="New board name"
              placeholder="New board name"
              value={name}
              maxLength={100}
              onChange={(e) => setName(e.target.value)}
              className="flex-1 rounded border border-gray-700 bg-gray-900 px-3 py-2 text-white placeholder-gray-500 focus:border-rose-500 focus:outline-none"
            />
            <button type="submit" disabled={creating || !name.trim()} className="rounded bg-rose-600 px-4 py-2 font-semibold text-white hover:bg-rose-500 disabled:cursor-not-allowed disabled:opacity-50">
              {creating ? "Creating…" : "Create board"}
            </button>
          </form>
          {createError && <p role="alert" className="text-sm text-red-400">{createError}</p>}

          {status === "loading" && <p role="status" className="text-gray-400">Loading boards…</p>}

          {status === "error" && (
            <div role="alert" className="flex items-center gap-3 text-gray-300">
              <span>{error ?? "Unable to load your boards."}</span>
              <button onClick={() => void load()} className="rounded bg-gray-800 px-3 py-1 hover:bg-gray-700">Retry</button>
            </div>
          )}

          {status === "ready" && boards.length === 0 && <p className="text-gray-400">You don&apos;t have any boards yet. Create your first board above.</p>}

          {boards.length > 0 && (
            <ul className="grid gap-4 sm:grid-cols-2">
              {boards.map((board) => (
                <li key={board.id}>
                  <Link href={`/boards/${board.id}`} className="block rounded-lg border border-gray-800 bg-gray-900 p-4 hover:border-rose-500">
                    <div className="flex items-start justify-between gap-2">
                      <h2 className="truncate text-lg font-semibold text-white">{board.name}</h2>
                      <span className="rounded bg-gray-800 px-2 py-0.5 text-[10px] uppercase tracking-wide text-gray-400">{board.myRole}</span>
                    </div>
                    {board.description && <p className="mt-1 line-clamp-2 text-sm text-gray-400">{board.description}</p>}
                    <p className="mt-3 text-xs text-gray-500">
                      {plural(board.taskCount, "task")} · {plural(board.memberCount, "member")}
                    </p>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </main>
  );
}
