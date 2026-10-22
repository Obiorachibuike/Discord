import { z } from 'zod';
import { LIMITS } from '../constants.js';

export const createServerSchema = z.object({
  name: z.string().min(LIMITS.serverNameMin).max(LIMITS.serverNameMax),
  description: z.string().max(LIMITS.serverDescriptionMax).optional(),
});

export const updateServerSchema = z.object({
  name: z.string().min(LIMITS.serverNameMin).max(LIMITS.serverNameMax).optional(),
  description: z.string().max(LIMITS.serverDescriptionMax).nullable().optional(),
});

export const createInviteSchema = z.object({
  expiresInHours: z.number().int().min(1).max(24 * 30).optional().nullable(),
  maxUses: z.number().int().min(1).max(LIMITS.inviteMaxUsesMax).optional().nullable(),
});

export const transferOwnershipSchema = z.object({
  userId: z.string().min(1),
});

export const createRoleSchema = z.object({
  name: z.string().min(1).max(LIMITS.roleNameMax),
  permissions: z.string().regex(/^\d+$/, 'permissions must be a decimal string'),
  color: z
    .string()
    .regex(/^#[0-9a-fA-F]{6}$/)
    .nullable()
    .optional(),
});

export const updateRoleSchema = z.object({
  name: z.string().min(1).max(LIMITS.roleNameMax).optional(),
  permissions: z.string().regex(/^\d+$/).optional(),
  color: z
    .string()
    .regex(/^#[0-9a-fA-F]{6}$/)
    .nullable()
    .optional(),
  position: z.number().int().min(1).max(1000).optional(),
});

export const memberRoleAssignSchema = z.object({
  roleIds: z.array(z.string()).max(20),
});

export type CreateServerInput = z.infer<typeof createServerSchema>;
export type CreateInviteInput = z.infer<typeof createInviteSchema>;
