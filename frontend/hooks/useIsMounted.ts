import { useSyncExternalStore } from "react";

const subscribe = () => () => {};

/**
 * Returns false during SSR and the first hydration render, true afterwards.
 * Replaces the previous `useState + useEffect(() => setIsMounted(true))`
 * pattern (flagged by react-hooks/set-state-in-effect) with identical behaviour.
 */
export function useIsMounted(): boolean {
  return useSyncExternalStore(
    subscribe,
    () => true,
    () => false
  );
}
