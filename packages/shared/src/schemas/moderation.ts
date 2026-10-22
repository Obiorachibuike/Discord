import { z } from 'zod';
import { LIMITS } from '../constants.js';

export const moderationActionSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('KICK'), serverId: z.string().optional(), userId: z.string(), reason: z.string().max(512).optional() }),
  z.object({ type: z.literal('BAN'), serverId: z.string().optional(), userId: z.string(), reason: z.string().max(512).optional() }),
  z.object({ type: z.literal('UNBAN'), serverId: z.string().optional(), userId: z.string(), reason: z.string().max(512).optional() }),
  z.object({
    type: z.literal('TIMEOUT'),
    serverId: z.string().optional(),
    userId: z.string(),
    durationMinutes: z.number().int().min(1).max(LIMITS.timeoutMaxHours * 60),
    reason: z.string().max(512).optional(),
  }),
  z.object({ type: z.literal('UNTIMEOUT'), serverId: z.string().optional(), userId: z.string(), reason: z.string().max(512).optional() }),
]);

export const reportSchema = z.object({
  serverId: z.string().optional(),
  reportedUserId: z.string().optional(),
  messageId: z.string().optional(),
  reason: z.string().min(3).max(1024),
});

export const reviewReportSchema = z.object({
  status: z.enum(['RESOLVED', 'DISMISSED']),
  note: z.string().max(1024).optional(),
});

export type ModerationActionInput = z.infer<typeof moderationActionSchema>;
