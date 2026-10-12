"use client";
import { useRealtimeStore } from "@/store/useRealtimeStore";
import type { RealtimeStatus } from "@/store/useRealtimeStore";

const LOOK: Record<Exclude<RealtimeStatus, "idle">, { dot: string; label: string; hint: string }> = {
  connecting: { dot: "bg-yellow-400 animate-pulse", label: "Connecting…", hint: "Connecting to live updates" },
  live: { dot: "bg-emerald-400", label: "Live", hint: "Changes from other people appear instantly" },
  reconnecting: { dot: "bg-yellow-400 animate-pulse", label: "Reconnecting…", hint: "Live updates paused; the board will refresh when the connection is back" },
  offline: { dot: "bg-gray-500", label: "Not live", hint: "Live updates are off. Reload the page to try again" },
};

/** Small header badge showing whether the board is receiving live updates. */
export default function LiveIndicator() {
  const status = useRealtimeStore((s) => s.status);
  if (status === "idle") return null;
  const look = LOOK[status];
  return (
    <span role="status" title={look.hint} className="flex items-center gap-2 text-xs text-gray-300">
      <span aria-hidden="true" className={`h-2 w-2 rounded-full ${look.dot}`} />
      {look.label}
    </span>
  );
}
