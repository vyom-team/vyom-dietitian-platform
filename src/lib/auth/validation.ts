import { z } from "zod";

/**
 * Authentication schemas.
 *
 * Shared by the client forms (React Hook Form resolver) and the Server Actions.
 * Client-side validation is a convenience; the server re-validates with the
 * same schema because anything arriving at an action is untrusted.
 */

const email = z
  .string()
  .trim()
  .min(1, "Email is required")
  .max(255, "Email is too long")
  .email("Enter a valid email address")
  // Stored lowercase so one person maps to exactly one profile.
  .transform((value) => value.toLowerCase());

/**
 * Password rules.
 *
 * Length is the requirement that actually matters; composition rules mostly
 * push people towards predictable substitutions. 10 characters with a
 * confirmation is a reasonable floor, and Supabase enforces its own configured
 * minimum on top.
 */
const password = z
  .string()
  .min(10, "Use at least 10 characters")
  .max(72, "Password must be 72 characters or fewer");

export const loginSchema = z.object({
  email,
  // Not length-validated: an existing password predating a rule change must
  // still be enterable, and the server decides whether it is correct.
  password: z.string().min(1, "Password is required"),
  redirectTo: z.string().optional(),
});

export const registerSchema = z
  .object({
    fullName: z
      .string()
      .trim()
      .min(2, "Enter your full name")
      .max(120, "Name is too long"),
    email,
    password,
    confirmPassword: z.string(),
  })
  .refine((values) => values.password === values.confirmPassword, {
    message: "Passwords do not match",
    path: ["confirmPassword"],
  });

export const forgotPasswordSchema = z.object({ email });

export const resetPasswordSchema = z
  .object({
    password,
    confirmPassword: z.string(),
  })
  .refine((values) => values.password === values.confirmPassword, {
    message: "Passwords do not match",
    path: ["confirmPassword"],
  });

export type LoginInput = z.infer<typeof loginSchema>;
export type RegisterInput = z.infer<typeof registerSchema>;
export type ForgotPasswordInput = z.infer<typeof forgotPasswordSchema>;
export type ResetPasswordInput = z.infer<typeof resetPasswordSchema>;
