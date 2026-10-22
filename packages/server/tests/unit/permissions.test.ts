import { describe, expect, it } from 'vitest';
import {
  ALL_PERMISSIONS,
  DEFAULT_ROLE_PERMISSIONS,
  Permissions,
  canManageRole,
  combineRolePermissions,
  hasPermission,
  resolveChannelPermissions,
} from '@aether/shared';

describe('permission bit flags', () => {
  it('hasPermission is all-of semantics', () => {
    const granted = Permissions.VIEW_CHANNELS | Permissions.SEND_MESSAGES;
    expect(hasPermission(granted, Permissions.VIEW_CHANNELS)).toBe(true);
    expect(hasPermission(granted, Permissions.SEND_MESSAGES)).toBe(true);
    expect(hasPermission(granted, Permissions.MANAGE_CHANNELS)).toBe(false);
    expect(hasPermission(granted, Permissions.VIEW_CHANNELS | Permissions.SEND_MESSAGES)).toBe(true);
    expect(hasPermission(granted, Permissions.VIEW_CHANNELS | Permissions.BAN_MEMBERS)).toBe(false);
  });

  it('combineRolePermissions unions roles', () => {
    const combined = combineRolePermissions([Permissions.VIEW_CHANNELS, Permissions.SEND_MESSAGES]);
    expect(hasPermission(combined, Permissions.VIEW_CHANNELS | Permissions.SEND_MESSAGES)).toBe(true);
  });

  it('default member role cannot moderate', () => {
    const member = DEFAULT_ROLE_PERMISSIONS.Member;
    expect(hasPermission(member, Permissions.SEND_MESSAGES)).toBe(true);
    expect(hasPermission(member, Permissions.KICK_MEMBERS)).toBe(false);
    expect(hasPermission(member, Permissions.MANAGE_SERVER)).toBe(false);
  });

  it('administrator has every permission', () => {
    for (const bit of Object.values(Permissions)) {
      expect(hasPermission(DEFAULT_ROLE_PERMISSIONS.Administrator, bit)).toBe(true);
    }
    expect(DEFAULT_ROLE_PERMISSIONS.Administrator).toBe(ALL_PERMISSIONS);
  });
});

describe('resolveChannelPermissions', () => {
  it('applies deny then allow (allow wins over role base, deny removes)', () => {
    const base = Permissions.VIEW_CHANNELS | Permissions.SEND_MESSAGES;
    // Deny SEND on this channel.
    const resolved = resolveChannelPermissions({
      serverBase: base,
      channelDeny: Permissions.SEND_MESSAGES,
      isOwner: false,
    });
    expect(hasPermission(resolved, Permissions.SEND_MESSAGES)).toBe(false);
    expect(hasPermission(resolved, Permissions.VIEW_CHANNELS)).toBe(true);
  });

  it('channel allow can grant a permission the roles lack', () => {
    const resolved = resolveChannelPermissions({
      serverBase: Permissions.VIEW_CHANNELS,
      channelAllow: Permissions.PIN_MESSAGES,
      isOwner: false,
    });
    expect(hasPermission(resolved, Permissions.PIN_MESSAGES)).toBe(true);
  });

  it('owner bypasses all restrictions', () => {
    const resolved = resolveChannelPermissions({
      serverBase: 0n,
      channelDeny: ALL_PERMISSIONS,
      isOwner: true,
    });
    expect(resolved).toBe(ALL_PERMISSIONS);
  });

  it('deny-by-default: empty grants mean no permissions', () => {
    const resolved = resolveChannelPermissions({ serverBase: 0n, isOwner: false });
    expect(resolved).toBe(0n);
  });
});

describe('role hierarchy (canManageRole)', () => {
  it('owner can manage anyone except themselves is handled by callers', () => {
    expect(canManageRole(0, 99, true, false)).toBe(true);
  });

  it('nobody can moderate the owner', () => {
    expect(canManageRole(99, 1, true, true)).toBe(false);
    expect(canManageRole(99, 1, false, true)).toBe(false);
  });

  it('strictly higher role position required', () => {
    expect(canManageRole(3, 2, false, false)).toBe(true);
    expect(canManageRole(2, 2, false, false)).toBe(false);
    expect(canManageRole(1, 3, false, false)).toBe(false);
  });
});
