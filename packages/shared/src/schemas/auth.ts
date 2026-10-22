import { z } from 'zod';
import { LIMITS } from '../constants.js';

export const usernameSchema = z
  .string()
  .min(LIMITS.usernameMin)
  .max(LIMITS.usernameMax)
  .regex(/^[a-z0-9_.-]+$/i, 'Only letters, numbers, dot, dash and underscore');

export const displayNameSchema = z
  .string()
  .min(LIMITS.displayNameMin)
  .max(LIMITS.displayNameMax);

export const emailSchema = z.string().email().max(254);

export const passwordSchema = z
  .string()
  .min(LIMITS.passwordMin)
  .max(LIMITS.passwordMax);

export const registerSchema = z.object({
  email: emailSchema,
  username: usernameSchema,
  displayName: displayNameSchema.optional(),
  password: passwordSchema,
});

export const loginSchema = z.object({
  emailOrUsername: z.string().min(3).max(254),
  password: z.string().min(1).max(LIMITS.passwordMax),
});

export const forgotPasswordSchema = z.object({ email: emailSchema });

export const resetPasswordSchema = z.object({
  token: z.string().min(10).max(200),
  password: passwordSchema,
});

export const verifyEmailSchema = z.object({ token: z.string().min(10).max(200) });

export type RegisterInput = z.infer<typeof registerSchema>;
export type LoginInput = z.infer<typeof loginSchema>;
