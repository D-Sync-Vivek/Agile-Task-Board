import { z } from "zod";
import { DEFAULT_ACTIVITY_LIMIT, MAX_ACTIVITY_LIMIT } from "../services/activity.service";

export const activityQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(MAX_ACTIVITY_LIMIT).default(DEFAULT_ACTIVITY_LIMIT),
  cursor: z.uuid("Invalid cursor").optional(),
});

export type ActivityQuery = z.infer<typeof activityQuerySchema>;
