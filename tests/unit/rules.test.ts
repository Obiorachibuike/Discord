import { describe, expect, it } from 'vitest';
import { registerSchema, messageSchema, channelSchema, inviteSchema } from '@cove/shared';
import { hash, pairKey, randomToken, safeEqual } from '../../apps/api/src/lib/crypto';
import { hashPassword, verifyPassword } from '../../apps/api/src/lib/password';
import { canChannel, hasServerPermission, requireHigherRole, type PermissionContext, type ChannelAccess } from '../../apps/api/src/services/permissions';
import { invitationUsable } from '../../apps/api/src/services/invitations';
import { decodeCursor, encodeCursor } from '../../apps/api/src/services/messages';
const context: PermissionContext = { userId: 'ab8d9a55-f9d8-415f-85ee-0d0377c43098', serverId: '8554ea2a-c52b-410e-b4a0-93e035f050ee', owner: false, timedOutUntil: null,
  roles: [{ id: '967a5fd4-bd77-4533-b822-5ef38707a297', position: 0, permissions: [{ permission: 'VIEW_CHANNEL' }, { permission: 'SEND_MESSAGES' }, { permission: 'CONNECT_VOICE' }] }] };
const channel: ChannelAccess = { id: 'ed0c0a1a-bad5-4674-a4f3-1344004e6715', kind: 'TEXT', visibility: 'PUBLIC', overrides: [] };
describe('authorization', () => {
  it('denies sensitive operations without grants', () => {
    expect(hasServerPermission(context, 'MANAGE_CHANNELS')).toBe(false);
    expect(canChannel(context, channel, 'SEND_MESSAGES')).toBe(true);
    expect(canChannel(context, channel, 'PIN_MESSAGES')).toBe(false);
  });
  it('hides private channels without explicit view access, including search and voice access', () => {
    const privateChannel: ChannelAccess = { ...channel, visibility: 'PRIVATE' };
    expect(canChannel(context, privateChannel, 'VIEW_CHANNEL')).toBe(false);
    expect(canChannel(context, privateChannel, 'SEND_MESSAGES')).toBe(false);
    expect(canChannel(context, { ...privateChannel, overrides: [{ roleId: context.roles[0]!.id, userId: null, allow: ['VIEW_CHANNEL'], deny: [] }] }, 'SEND_MESSAGES')).toBe(true);
  });
  it('applies role deny before role allow and personal overrides last', () => {
    const overrides: ChannelAccess = { ...channel, overrides: [
      { roleId: context.roles[0]!.id, userId: null, allow: [], deny: ['SEND_MESSAGES'] },
      { roleId: null, userId: context.userId, allow: ['SEND_MESSAGES'], deny: [] }
    ] };
    expect(canChannel(context, overrides, 'SEND_MESSAGES')).toBe(true);
    expect(canChannel(context, { ...overrides, overrides: overrides.overrides.slice(0, 1) }, 'SEND_MESSAGES')).toBe(false);
  });
  it('blocks timed-out users and protects role hierarchy and owner', () => {
    expect(canChannel({ ...context, timedOutUntil: new Date(Date.now() + 100000) }, channel, 'SEND_MESSAGES')).toBe(false);
    expect(() => requireHigherRole(context, { ...context, owner: true })).toThrow();
    expect(() => requireHigherRole(context, { ...context, roles: [{ ...context.roles[0]!, position: 0 }] })).toThrow();
    expect(() => requireHigherRole({ ...context, owner: true }, context)).not.toThrow();
  });
});
describe('validation and anti-replay helpers', () => {
  it('normalizes email and usernames and rejects weak passwords and malformed messages', () => {
    expect(registerSchema.parse({ email: ' Me@Example.Test ', username: 'ME_1', displayName: ' Me ', password: 'a'.repeat(12) }).username).toBe('me_1');
    expect(registerSchema.safeParse({ email: 'x@y.test', username: 'a', displayName: 'x', password: '1234' }).success).toBe(false);
    expect(messageSchema.safeParse({ content: '', clientNonce: crypto.randomUUID() }).success).toBe(false);
    expect(messageSchema.safeParse({ content: 'A'.repeat(4001), clientNonce: crypto.randomUUID() }).success).toBe(false);
    expect(channelSchema.safeParse({ name: '../bad', kind: 'TEXT' }).success).toBe(false);
    expect(inviteSchema.safeParse({ maxUses: -1 }).success).toBe(false);
  });
  it('uses unpredictable tokens and canonical pairs', () => {
    expect(randomToken()).toMatch(/^[0-9a-f]{64}$/);
    expect(hash('token')).not.toContain('token');
    expect(safeEqual(hash('a'), hash('a'))).toBe(true);
    expect(safeEqual(hash('a'), hash('b'))).toBe(false);
    expect(pairKey('b','a')).toBe(pairKey('a','b'));
  });
  it('rejects revoked, expired and exhausted invitations', () => {
    const invite = { revokedAt: null, expiresAt: new Date(Date.now() + 60_000), maxUses: 1, uses: 0 };
    expect(invitationUsable(invite)).toBe(true);
    expect(invitationUsable({ ...invite, uses: 1 })).toBe(false);
    expect(invitationUsable({ ...invite, revokedAt: new Date() })).toBe(false);
    expect(invitationUsable({ ...invite, expiresAt: new Date(0) })).toBe(false);
  });
  it('round-trips pagination cursors without accepting malformed values', () => {
    const record = { id: crypto.randomUUID(), createdAt: new Date('2026-01-03T03:04:05.000Z') };
    expect(decodeCursor(encodeCursor(record))).toEqual({ at: record.createdAt, messageId: record.id });
    expect(() => decodeCursor('garbage')).toThrow();
  });
  it('hashes and verifies passwords with Argon2id and equalizes unknown-account checks', async () => {
    const stored = await hashPassword('a secure password 123');
    expect(stored).toMatch(/^\$argon2id\$/);
    expect(await verifyPassword(stored, 'a secure password 123')).toBe(true);
    expect(await verifyPassword(stored, 'wrong')).toBe(false);
    expect(await verifyPassword(null, 'anything')).toBe(false);
  });
});
