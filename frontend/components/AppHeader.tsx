"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useAuthStore } from "@/store/useAuthStore";
import { useBoardListStore } from "@/store/useBoardListStore";
import { useBoardStore } from "@/store/useBoardStore";

interface Props {
  title: string;
  subtitle?: string;
  backHref?: string;
}

export default function AppHeader({ title, subtitle, backHref }: Props) {
  const router = useRouter();
  const user = useAuthStore((state) => state.user);
  const logout = useAuthStore((state) => state.logout);

  async function handleLogout() {
    await logout();
    // Drop every cached copy of the previous user's data.
    useBoardStore.getState().reset();
    useBoardListStore.getState().reset();
    router.replace("/login");
  }

  return (
    <header className="flex-none border-b border-gray-800 bg-gray-900/50 px-6 py-4 backdrop-blur-sm">
      <div className="flex items-center justify-between gap-4">
        <div className="min-w-0">
          {backHref && (
            <Link href={backHref} className="text-xs text-gray-400 hover:text-rose-400">
              ← All boards
            </Link>
          )}
          <h1 className="truncate text-2xl font-bold tracking-tight text-white">{title}</h1>
          {subtitle && <p className="mt-1 text-xs text-gray-400">{subtitle}</p>}
        </div>

        <div className="flex items-center gap-3">
          {user && <span className="hidden text-sm text-gray-300 sm:inline">{user.name}</span>}
          <button onClick={handleLogout} className="rounded border border-gray-700 bg-gray-800 px-3 py-1.5 text-sm text-gray-200 hover:bg-gray-700">
            Log out
          </button>
        </div>
      </div>
    </header>
  );
}
