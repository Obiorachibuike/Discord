import { z } from 'zod';
import { LIMITS } from '../constants.js';

export const friendRequestSchema = z.object({
  username: z.string().min(3).max(LIMITS.usernameMax),
});

export const createDmSchema = z.object({
  userId: z.string().min(1),
});

export const createGroupSchema = z.object({
  name: z.string().min(1).max(LIMITS.conversationNameMax),
  memberIds: z.array(z.string()).min(1).max(9),
});

export const updateConversationSchema = z.object({
  name: z.string().min(1).max(LIMITS.conversationNameMax),
});

export const addGroupMembersSchema = z.object({
  memberIds: z.array(z.string()).min(1).max(9),
});

export const markReadSchema = z.object({
  messageId: z.string().optional(),
});

export type FriendRequestInput = z.infer<typeof friendRequestSchema>;
export type CreateGroupInput = z.infer<typeof createGroupSchema>;
