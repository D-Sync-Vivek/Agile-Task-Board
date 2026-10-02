import { z } from "zod";

const email = z
  .string()
  .trim()
  .toLowerCase()
  .pipe(z.email("Enter a valid email address").max(255, "Email is too long"));

export const registerSchema = z.object({
  name: z.string().trim().min(1, "Name is required").max(100, "Name must be at most 100 characters"),
  email,
  password: z
    .string()
    .min(8, "Password must be at least 8 characters")
    // bcrypt silently ignores everything after 72 bytes, so reject instead of truncating.
    .refine((v) => Buffer.byteLength(v, "utf8") <= 72, "Password must be at most 72 bytes"),
});

export const loginSchema = z.object({
  email,
  // No strength rules on login; only bound the size so nobody can make us hash megabytes.
  password: z.string().min(1, "Password is required").max(128, "Password is too long"),
});

export type RegisterInput = z.infer<typeof registerSchema>;
export type LoginInput = z.infer<typeof loginSchema>;
