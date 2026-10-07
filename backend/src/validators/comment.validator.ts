import { z } from "zod";

const content = z.string().trim().min(1, "Comment can't be empty").max(5000, "Comment must be at most 5000 characters");

export const createCommentSchema = z.object({ content });
export const updateCommentSchema = z.object({ content });

export type CreateCommentInput = z.infer<typeof createCommentSchema>;
export type UpdateCommentInput = z.infer<typeof updateCommentSchema>;
