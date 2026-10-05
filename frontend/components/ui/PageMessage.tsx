import type { ReactNode } from "react";

/** Centered status text used for loading / error / empty states. */
export default function PageMessage({ children, role }: { children: ReactNode; role?: "status" | "alert" }) {
  return (
    <div role={role} className="flex flex-1 flex-col items-center justify-center gap-3 p-8 text-center text-gray-300">
      {children}
    </div>
  );
}
