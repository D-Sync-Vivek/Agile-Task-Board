"use client";
import { useToastStore } from "@/store/useToastStore";

/** Renders the toast stack. Mounted once in the root layout. */
export default function Toaster() {
  const toasts = useToastStore((state) => state.toasts);
  const dismiss = useToastStore((state) => state.dismiss);

  return (
    <div className="pointer-events-none fixed bottom-4 right-4 z-50 flex w-80 max-w-[calc(100vw-2rem)] flex-col gap-2" aria-live="polite">
      {toasts.map((t) => (
        <div
          key={t.id}
          role={t.kind === "error" ? "alert" : "status"}
          className={`pointer-events-auto flex items-start justify-between gap-3 rounded-lg border px-4 py-3 text-sm shadow-xl ${
            t.kind === "error" ? "border-red-500/60 bg-red-950 text-red-100" : "border-emerald-500/60 bg-emerald-950 text-emerald-100"
          }`}
        >
          <span>{t.message}</span>
          <button onClick={() => dismiss(t.id)} aria-label="Dismiss notification" className="text-lg leading-none opacity-70 hover:opacity-100">
            ×
          </button>
        </div>
      ))}
    </div>
  );
}
