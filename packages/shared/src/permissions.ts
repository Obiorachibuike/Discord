/**
 * Permission bit flags for server roles and channel overrides.
 * Deny-by-default: a member only exercises a permission when the resolved
 * bitmask grants it (owner always has every permission).
 */
export const Permissions = {
  MANAGE_SERVER: 1n << 0n,
  MANAGE_CHANNELS: 1n << 1n,
  MANAGE_ROLES: 1n << 2n,
  MANAGE_INVITES: 1n << 3n,
  VIEW_CHANNELS: 1n << 4n,
  SEND_MESSAGES: 1n << 5n,
  ATTACH_FILES: 1n << 6n,
  MANAGE_MESSAGES: 1n << 7n,
  PIN_MESSAGES: 1n << 8n,
  MENTION_EVERYONE: 1n << 9n,
  MANAGE_MEMBERS: 1n << 10n,
  KICK_MEMBERS: 1n << 11n,
  BAN_MEMBERS: 1n << 12n,
  MODERATE_MEMBERS: 1n << 13n,
  CONNECT_VOICE: 1n << 14n,
  SPEAK_VOICE: 1n << 15n,
  VIDEO: 1n << 16n,
  SCREEN_SHARE: 1n << 17n,
  VIEW_AUDIT_LOG: 1n << 18n,
} as const;

export type PermissionKey = keyof typeof Permissions;

export const ALL_PERMISSIONS: bigint = Object.values(Permissions).reduce(
  (acc, bit) => acc | bit,
  0n,
);

/** Default permission sets for the built-in roles. */
export const DEFAULT_ROLE_PERMISSIONS: Record<
  'Administrator' | 'Moderator' | 'Member',
  bigint
> = {
  Administrator: ALL_PERMISSIONS,
  Moderator:
    Permissions.VIEW_CHANNELS |
    Permissions.SEND_MESSAGES |
    Permissions.ATTACH_FILES |
    Permissions.MANAGE_MESSAGES |
    Permissions.PIN_MESSAGES |
    Permissions.MANAGE_ROLES |
    Permissions.MANAGE_INVITES |
    Permissions.KICK_MEMBERS |
    Permissions.MODERATE_MEMBERS |
    Permissions.CONNECT_VOICE |
    Permissions.SPEAK_VOICE |
    Permissions.VIDEO |
    Permissions.SCREEN_SHARE |
    Permissions.VIEW_AUDIT_LOG,
  Member:
    Permissions.VIEW_CHANNELS |
    Permissions.SEND_MESSAGES |
    Permissions.ATTACH_FILES |
    Permissions.CONNECT_VOICE |
    Permissions.SPEAK_VOICE |
    Permissions.VIDEO |
    Permissions.SCREEN_SHARE,
};

export function hasPermission(granted: bigint, permission: bigint): boolean {
  return (granted & permission) === permission;
}

/** Union of role permission bitmasks. */
export function combineRolePermissions(rolePermissions: bigint[]): bigint {
  return rolePermissions.reduce((acc, p) => acc | p, 0n);
}

/**
 * Resolve effective channel permissions.
 * Order: server base (roles) → channel allow → channel deny.
 */
export function resolveChannelPermissions(input: {
  serverBase: bigint;
  channelAllow?: bigint | null;
  channelDeny?: bigint | null;
  isOwner: boolean;
}): bigint {
  if (input.isOwner) return ALL_PERMISSIONS;
  let effective = input.serverBase;
  if (input.channelDeny) effective &= ~input.channelDeny;
  if (input.channelAllow) effective |= input.channelAllow;
  return effective;
}

/** Roles above the target role (strictly higher position) can moderate it. */
export function canManageRole(
  actorHighestRolePosition: number,
  targetHighestRolePosition: number,
  isActorOwner: boolean,
  isTargetOwner: boolean,
): boolean {
  if (isTargetOwner) return false;
  if (isActorOwner) return true;
  return actorHighestRolePosition > targetHighestRolePosition;
}
