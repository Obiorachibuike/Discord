import { z } from 'zod';
import { LIMITS } from '../constants.js';

export const createMessageSchema = z.object({
  channelId: z.string().min(1),
  content: z.string().max(LIMITS.messageMax).optional(),
  replyToId: z.string().nullable().optional(),
  attachmentIds: z.array(z.string()).max(LIMITS.attachmentsPerMessage).optional(),
  /** Client-generated id for idempotent retries. */
  clientId: z.string().min(8).max(64).optional(),
});

export const updateMessageSchema = z.object({
  content: z.string().min(1).max(LIMITS.messageMax),
});

export const reactToMessageSchema = z.object({
  emoji: z.string().min(1).max(32),
});

export const queryMessagesSchema = z.object({
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(LIMITS.messagePageMax).optional(),
  direction: z.enum(['before', 'after']).optional(),
});

export const searchMessagesSchema = z.object({
  q: z.string().min(LIMITS.searchQueryMin).max(LIMITS.searchQueryMax),
  serverId: z.string().optional(),
  channelId: z.string().optional(),
  authorId: z.string().optional(),
  after: z.string().optional(),
  before: z.string().optional(),
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(50).optional(),
});

export const createConversationMessageSchema = z.object({
  content: z.string().max(LIMITS.messageMax).optional(),
  replyToId: z.string().nullable().optional(),
  attachmentIds: z.array(z.string()).max(LIMITS.attachmentsPerMessage).optional(),
  clientId: z.string().min(8).max(64).optional(),
});

export type CreateMessageInput = z.infer<typeof createMessageSchema>;
export type SearchMessagesInput = z.infer<typeof searchMessagesSchema>;
