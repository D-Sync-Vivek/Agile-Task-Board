import { z } from "zod";

const name = z.string().trim().min(1, "Board name is required").max(100, "Board name must be at most 100 characters");

// Empty / whitespace-only description is stored as null.
const description = z
  .string()
  .trim()
  .max(2000, "Description must be at most 2000 characters")
  .transform((v) => (v === "" ? null : v))
  .nullable();

export const createBoardSchema = z.object({
  name,
  description: description.optional(),
});

export const updateBoardSchema = z
  .object({
    name: name.optional(),
    description: description.optional(),
  })
  .refine((v) => v.name !== undefined || v.description !== undefined, {
    message: "Provide at least one field to update (name or description)",
  });

export type CreateBoardInput = z.infer<typeof createBoardSchema>;
export type UpdateBoardInput = z.infer<typeof updateBoardSchema>;
