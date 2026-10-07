"use client";
import { useEffect, useState } from "react";

/** The current time, refreshed on an interval, so relative timestamps ("2 min ago") stay accurate while a view is open. */
export function useNow(intervalMs = 30_000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(id);
  }, [intervalMs]);
  return now;
}
