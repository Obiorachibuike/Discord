import { z } from 'zod';
import { LIMITS } from '../constants.js';
import { displayNameSchema, usernameSchema } from './auth.js';

export const presenceStatusSchema = z.enum([
  'ONLINE',
  'IDLE',
  'DND',
  'INVISIBLE',
  'OFFLINE',
]);

export const updateProfileSchema = z.object({
  displayName: displayNameSchema.optional(),
  bio: z.string().max(LIMITS.bioMax).optional(),
  customStatus: z.string().max(LIMITS.customStatusMax).nullable().optional(),
});

export const updateAccountSchema = z.object({
  username: usernameSchema.optional(),
  currentPassword: z.string().min(1).max(LIMITS.passwordMax).optional(),
  newPassword: z.string().min(LIMITS.passwordMin).max(LIMITS.passwordMax).optional(),
});

export const privacySettingsSchema = z.object({
  allowDmsFromFriendsOnly: z.boolean().optional(),
  allowFriendRequests: z.boolean().optional(),
  showPresenceToFriendsOnly: z.boolean().optional(),
});

export const notificationSettingsSchema = z.object({
  dmNotifications: z.boolean().optional(),
  mentionNotifications: z.boolean().optional(),
  friendRequestNotifications: z.boolean().optional(),
  mutedServerIds: z.array(z.string()).max(200).optional(),
});

export const updatePresenceSchema = z.object({
  status: presenceStatusSchema,
});

export type UpdateProfileInput = z.infer<typeof updateProfileSchema>;
export type PrivacySettingsInput = z.infer<typeof privacySettingsSchema>;
