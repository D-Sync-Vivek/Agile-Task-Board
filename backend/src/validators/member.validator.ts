import { z } from "zod";

// OWNER is deliberately not grantable: a board has exactly one owner (its creator).
const assignableRole = z.enum(["ADMIN", "MEMBER", "VIEWER"], { error: "Role must be ADMIN, MEMBER or VIEWER" });

export const addMemberSchema = z.object({
  email: z.string().trim().toLowerCase().pipe(z.email("Enter a valid email address").max(255, "Email is too long")),
  role: assignableRole.default("MEMBER"),
});

export const updateMemberSchema = z.object({ role: assignableRole });

export type AddMemberInput = z.infer<typeof addMemberSchema>;
export type UpdateMemberInput = z.infer<typeof updateMemberSchema>;
