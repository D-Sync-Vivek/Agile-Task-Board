import { AsyncLocalStorage } from "node:async_hooks";
import type { RequestHandler } from "express";
import type { ActivityDto } from "../services/activity.service";

/**
 * Activity entries created while handling ONE request, waiting to be broadcast.
 *
 * Why not broadcast straight from the service: the entry is written inside a database transaction that may still
 * roll back, and clients must never be told about something that didn't happen. So `recordActivity` only queues the
 * entry here; the controller flushes the queue AFTER the service returned (= committed). If the service throws,
 * nobody flushes and the queue dies with the request.
 *
 * AsyncLocalStorage gives each request its own queue without threading a parameter through every service call.
 */
const storage = new AsyncLocalStorage<ActivityDto[]>();

export const activityOutbox: RequestHandler = (_req, _res, next) => {
  storage.run([], next);
};

/** No-op outside a request (scripts, seeds, tests calling services directly). */
export function queueActivity(entry: ActivityDto): void {
  storage.getStore()?.push(entry);
}

/** Takes everything queued so far (and empties the queue). */
export function drainActivity(): ActivityDto[] {
  const queue = storage.getStore();
  return queue ? queue.splice(0, queue.length) : [];
}
