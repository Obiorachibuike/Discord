import { describe, expect, it } from 'vitest';
import {
  registerSchema,
  loginSchema,
  createMessageSchema,
  createChannelSchema,
  searchMessagesSchema,
  friendRequestSchema,
  moderationActionSchema,
  updateProfileSchema,
} from '@aether/shared';

describe('auth validation', () => {
  it('rejects weak passwords and bad usernames', () => {
    expect(
      registerSchema.safeParse({
        email: 'a@b.co',
        username: 'ab',
        password: 'short',
      }).success,
    ).toBe(false);
    expect(
      registerSchema.safeParse({
        email: 'not-an-email',
        username: 'valid_user',
        password: 'longenoughpassword',
      }).success,
    ).toBe(false);
    expect(
      registerSchema.safeParse({
        email: 'a@b.co',
        username: 'bad name!',
        password: 'longenoughpassword',
      }).success,
    ).toBe(false);
  });

  it('accepts a valid registration', () => {
    const parsed = registerSchema.safeParse({
      email: 'a@b.co',
      username: 'valid_user-1',
      password: 'longenoughpassword',
      displayName: 'Valid',
    });
    expect(parsed.success).toBe(true);
  });

  it('login requires both fields', () => {
    expect(loginSchema.safeParse({ emailOrUsername: 'abc', password: '' }).success).toBe(false);
    expect(loginSchema.safeParse({ emailOrUsername: 'abc', password: 'p' }).success).toBe(true);
  });
});

describe('message validation', () => {
  it('enforces max length', () => {
    expect(createMessageSchema.safeParse({ channelId: 'c', content: 'x'.repeat(4001) }).success).toBe(false);
    expect(createMessageSchema.safeParse({ channelId: 'c', content: 'hello' }).success).toBe(true);
  });

  it('requires a channel id', () => {
    expect(createMessageSchema.safeParse({ content: 'hi' }).success).toBe(false);
  });
});

describe('channel validation', () => {
  it('normalizes channel names', () => {
    const parsed = createChannelSchema.parse({ name: 'General Chat' });
    expect(parsed.name).toBe('general-chat');
  });

  it('defaults type to TEXT and privacy to public', () => {
    const parsed = createChannelSchema.parse({ name: 'general' });
    expect(parsed.type).toBe('TEXT');
    expect(parsed.isPrivate).toBe(false);
  });
});

describe('search validation', () => {
  it('requires a minimum query length', () => {
    expect(searchMessagesSchema.safeParse({ q: 'a' }).success).toBe(false);
    expect(searchMessagesSchema.safeParse({ q: 'hello' }).success).toBe(true);
  });
});

describe('friend + moderation validation', () => {
  it('friend request targets a username', () => {
    expect(friendRequestSchema.safeParse({ username: 'x' }).success).toBe(false);
    expect(friendRequestSchema.safeParse({ username: 'ada' }).success).toBe(true);
  });

  it('timeout requires duration', () => {
    expect(
      moderationActionSchema.safeParse({ type: 'TIMEOUT', userId: 'u' }).success,
    ).toBe(false);
    expect(
      moderationActionSchema.safeParse({ type: 'TIMEOUT', userId: 'u', durationMinutes: 10 })
        .success,
    ).toBe(true);
    expect(moderationActionSchema.safeParse({ type: 'NOPE', userId: 'u' }).success).toBe(false);
  });
});

describe('profile validation', () => {
  it('caps bio length', () => {
    expect(updateProfileSchema.safeParse({ bio: 'x'.repeat(501) }).success).toBe(false);
    expect(updateProfileSchema.safeParse({ customStatus: 'chilling' }).success).toBe(true);
  });
});
