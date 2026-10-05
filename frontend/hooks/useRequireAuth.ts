"use client";
import { usePathname, useRouter } from "next/navigation";
import { useEffect } from "react";
import { useAuthStore } from "@/store/useAuthStore";
import type { AuthStatus } from "@/store/useAuthStore";

/**
 * Page guard: makes sure we know who the user is, and sends anonymous visitors to /login?next=<this page>.
 * This is a UX redirect only; the backend rejects unauthenticated requests regardless of what the client does.
 * (Auth is a cookie on the API's domain, which Next.js server code can't read, so the check is client-side.)
 */
export function useRequireAuth(): AuthStatus {
  const router = useRouter();
  const pathname = usePathname();
  const status = useAuthStore((state) => state.status);
  const fetchSession = useAuthStore((state) => state.fetchSession);

  useEffect(() => {
    if (status === "unknown") void fetchSession();
  }, [status, fetchSession]);

  useEffect(() => {
    if (status === "anonymous") router.replace(`/login?next=${encodeURIComponent(pathname)}`);
  }, [status, pathname, router]);

  return status;
}
