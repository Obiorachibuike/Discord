/** Shared product/limits constants used by client and server. */

export const LIMITS = {
  usernameMin: 3,
  usernameMax: 32,
  displayNameMin: 1,
  displayNameMax: 64,
  passwordMin: 10,
  passwordMax: 200,
  bioMax: 500,
  customStatusMax: 128,
  serverNameMin: 2,
  serverNameMax: 64,
  serverDescriptionMax: 512,
  channelNameMin: 2,
  channelNameMax: 64,
  channelTopicMax: 1024,
  messageMax: 4000,
  conversationNameMax: 64,
  searchQueryMin: 2,
  searchQueryMax: 256,
  inviteMaxUsesMax: 1000,
  attachmentsPerMessage: 8,
  uploadMaxBytes: 25 * 1024 * 1024,
  imageMaxBytes: 10 * 1024 * 1024,
  messagePageDefault: 50,
  messagePageMax: 100,
  memberPageDefault: 50,
  memberPageMax: 100,
  emojiPerMessage: 25,
  roleNameMax: 64,
  timeoutMaxHours: 24 * 28,
} as const;

export const SESSION_COOKIE = 'aether_session';
export const CSRF_COOKIE = 'aether_csrf';
export const CSRF_HEADER = 'x-aether-csrf';

export const CONNECTION = {
  heartbeatIntervalMs: 25_000,
  presenceExpiryMs: 90_000,
  typingExpiryMs: 7_000,
} as const;

export const INVITE_TOKEN_BYTES = 20;

export const UPLOAD_KINDS = ['image', 'video', 'audio', 'file'] as const;
export type UploadKind = (typeof UPLOAD_KINDS)[number];

export const ALLOWED_IMAGE_MIME = [
  'image/png',
  'image/jpeg',
  'image/gif',
  'image/webp',
  'image/avif',
] as const;

export const ALLOWED_VIDEO_MIME = ['video/mp4', 'video/webm'] as const;

export const ALLOWED_AUDIO_MIME = [
  'audio/mpeg',
  'audio/ogg',
  'audio/wav',
  'audio/webm',
  'audio/mp4',
] as const;

export const ALLOWED_FILE_MIME = [
  ...ALLOWED_IMAGE_MIME,
  ...ALLOWED_VIDEO_MIME,
  ...ALLOWED_AUDIO_MIME,
  'application/pdf',
  'text/plain',
  'application/zip',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation',
] as const;
