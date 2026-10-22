import { z } from 'zod';
import { LIMITS } from '../constants.js';

export const channelTypeSchema = z.enum(['TEXT', 'VOICE', 'ANNOUNCEMENT']);

export const createChannelSchema = z.object({
  name: z
    .string()
    .min(LIMITS.channelNameMin)
    .max(LIMITS.channelNameMax)
    .transform((v) => v.toLowerCase().replace(/\s+/g, '-')),
  type: channelTypeSchema.default('TEXT'),
  topic: z.string().max(LIMITS.channelTopicMax).optional(),
  categoryId: z.string().nullable().optional(),
  isPrivate: z.boolean().default(false),
});

export const updateChannelSchema = z.object({
  name: z
    .string()
    .min(LIMITS.channelNameMin)
    .max(LIMITS.channelNameMax)
    .transform((v) => v.toLowerCase().replace(/\s+/g, '-'))
    .optional(),
  topic: z.string().max(LIMITS.channelTopicMax).nullable().optional(),
  categoryId: z.string().nullable().optional(),
  position: z.number().int().min(0).max(10_000).optional(),
  isPrivate: z.boolean().optional(),
});

export const createCategorySchema = z.object({
  name: z.string().min(1).max(LIMITS.channelNameMax),
});

export const reorderChannelsSchema = z.object({
  items: z
    .array(
      z.object({
        id: z.string(),
        position: z.number().int().min(0),
        categoryId: z.string().nullable().optional(),
      }),
    )
    .min(1)
    .max(200),
});

export const channelOverrideSchema = z.object({
  allow: z.string().regex(/^\d+$/),
  deny: z.string().regex(/^\d+$/),
});

export type CreateChannelInput = z.infer<typeof createChannelSchema>;
