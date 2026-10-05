"use client";
import { useSyncExternalStore } from "react";

function subscribe(onChange: () => void) {
  window.addEventListener("popstate", onChange);
  return () => window.removeEventListener("popstate", onChange);
}

/**
 * The current URL query string ("?next=/x"), safe to call while rendering: it is "" on the server and during
 * hydration, then the real value on the client. (Reading window.location directly in render breaks prerendering.)
 */
export function useLocationSearch(): string {
  return useSyncExternalStore(
    subscribe,
    () => window.location.search,
    () => ""
  );
}
