import type {
  AttachmentDTO,
  ChannelDTO,
  ConversationDTO,
  MessageDTO,
  PublicUserDTO,
  ReactionDTO,
  RoleDTO,
  SelfUserDTO,
  ServerDTO,
  ServerMemberDTO,
  NotificationDTO,
} from '@aether/shared';
import { presence } from '../services/presence.service.js';

export function toPublicUser(user: {
  id: string;
  username: string;
  displayName: string;
  avatarUrl: string | null;
  bio?: string | null;
  customStatus?: string | null;
  createdAt?: Date;
}): PublicUserDTO {
  return {
    id: user.id,
    username: user.username,
    displayName: user.displayName,
    avatarUrl: user.avatarUrl,
    bio: user.bio ?? null,
    customStatus: user.customStatus ?? null,
    presenceStatus: presence.getVisibleStatus(user.id),
    createdAt: user.createdAt?.toISOString(),
  };
}

export function toSelfUser(user: {
  id: string;
  username: string;
  displayName: string;
  avatarUrl: string | null;
  bio: string | null;
  customStatus: string | null;
  email: string;
  emailVerifiedAt: Date | null;
  createdAt: Date;
  privacySettings: unknown;
  notificationSettings: unknown;
}): SelfUserDTO {
  return {
    ...toPublicUser(user),
    email: user.email,
    emailVerified: Boolean(user.emailVerifiedAt),
    privacy: (user.privacySettings as SelfUserDTO['privacy']) ?? {
      allowDmsFromFriendsOnly: false,
      allowFriendRequests: true,
      showPresenceToFriendsOnly: false,
    },
    notifications: (user.notificationSettings as SelfUserDTO['notifications']) ?? {
      dmNotifications: true,
      mentionNotifications: true,
      friendRequestNotifications: true,
      mutedServerIds: [],
    },
  };
}

export function toAttachment(a: {
  id: string;
  fileName: string;
  fileSize: number;
  mimeType: string;
  kind: string;
  width: number | null;
  height: number | null;
  url: string | null;
  storageKey: string;
}): AttachmentDTO {
  return {
    id: a.id,
    fileName: a.fileName,
    fileSize: a.fileSize,
    mimeType: a.mimeType,
    kind: a.kind as AttachmentDTO['kind'],
    url: a.url ?? `/api/uploads/${encodeURIComponent(a.storageKey)}`,
    width: a.width,
    height: a.height,
  };
}

export function toReactionGroups(
  reactions: { emoji: string; userId: string }[],
  meId: string,
): ReactionDTO[] {
  const map = new Map<string, ReactionDTO>();
  for (const r of reactions) {
    const g = map.get(r.emoji) ?? { emoji: r.emoji, count: 0, me: false, userIds: [] };
    g.count += 1;
    if (r.userId === meId) g.me = true;
    g.userIds.push(r.userId);
    map.set(r.emoji, g);
  }
  return [...map.values()];
}

export function toMessageDTO(
  m: {
    id: string;
    channelId: string | null;
    conversationId: string | null;
    content: string;
    createdAt: Date;
    editedAt: Date | null;
    clientId: string | null;
    author: Parameters<typeof toPublicUser>[0];
    replyTo: {
      id: string;
      content: string;
      author: Parameters<typeof toPublicUser>[0];
    } | null;
    attachments: Parameters<typeof toAttachment>[0][];
    reactions: { emoji: string; userId: string }[];
    pins: { id: string }[];
  },
  meId: string,
): MessageDTO {
  return {
    id: m.id,
    channelId: m.channelId,
    conversationId: m.conversationId,
    content: m.content,
    author: toPublicUser(m.author),
    replyTo: m.replyTo
      ? {
          id: m.replyTo.id,
          content: m.replyTo.content,
          author: toPublicUser(m.replyTo.author),
        }
      : null,
    attachments: m.attachments.map(toAttachment),
    reactions: toReactionGroups(m.reactions, meId),
    pinned: m.pins.length > 0,
    editedAt: m.editedAt?.toISOString() ?? null,
    createdAt: m.createdAt.toISOString(),
    clientId: m.clientId,
  };
}

export function toChannelDTO(c: {
  id: string;
  serverId: string;
  categoryId: string | null;
  name: string;
  type: string;
  topic: string | null;
  position: number;
  isPrivate: boolean;
}): ChannelDTO {
  return {
    id: c.id,
    serverId: c.serverId,
    categoryId: c.categoryId,
    name: c.name,
    type: c.type as ChannelDTO['type'],
    topic: c.topic,
    position: c.position,
    isPrivate: c.isPrivate,
    voiceParticipants: [],
  };
}

export function toRoleDTO(r: {
  id: string;
  name: string;
  color: string | null;
  permissions: bigint;
  position: number;
  isDefault: boolean;
}): RoleDTO {
  return {
    id: r.id,
    name: r.name,
    color: r.color,
    permissions: r.permissions.toString(),
    position: r.position,
    isDefault: r.isDefault,
  };
}

export function toServerDTO(
  s: {
    id: string;
    name: string;
    description: string | null;
    iconUrl: string | null;
    ownerId: string;
    _count?: { members: number };
  },
  myPermissions: bigint,
): ServerDTO {
  return {
    id: s.id,
    name: s.name,
    description: s.description,
    iconUrl: s.iconUrl,
    ownerId: s.ownerId,
    memberCount: s._count?.members ?? 0,
    myPermissions: myPermissions.toString(),
  };
}

export function toMemberDTO(m: {
  userId: string;
  nickname: string | null;
  joinedAt: Date;
  timeoutUntil: Date | null;
  user: Parameters<typeof toPublicUser>[0];
  roles: { roleId: string }[];
}): ServerMemberDTO {
  return {
    userId: m.userId,
    user: toPublicUser(m.user),
    roleIds: m.roles.map((r) => r.roleId),
    nickname: m.nickname,
    joinedAt: m.joinedAt.toISOString(),
    timeoutUntil: m.timeoutUntil?.toISOString() ?? null,
  };
}

export function toNotificationDTO(n: {
  id: string;
  type: string;
  title: string;
  body: string;
  data: unknown;
  readAt: Date | null;
  createdAt: Date;
}): NotificationDTO {
  return {
    id: n.id,
    type: n.type as NotificationDTO['type'],
    title: n.title,
    body: n.body,
    data: (n.data as Record<string, unknown>) ?? {},
    readAt: n.readAt?.toISOString() ?? null,
    createdAt: n.createdAt.toISOString(),
  };
}

export function toConversationDTO(
  c: {
    id: string;
    type: string;
    name: string | null;
    updatedAt: Date;
    members: { user: Parameters<typeof toPublicUser>[0] }[];
    messages: { content: string; createdAt: Date; author: { displayName: string } }[];
  },
  unread: number,
): ConversationDTO {
  const last = c.messages[0];
  return {
    id: c.id,
    type: c.type as ConversationDTO['type'],
    name: c.name,
    memberCount: c.members.length,
    members: c.members.map((m) => toPublicUser(m.user)),
    lastMessage: last
      ? {
          content: last.content.slice(0, 120),
          createdAt: last.createdAt.toISOString(),
          authorName: last.author.displayName,
        }
      : null,
    unread,
    updatedAt: c.updatedAt.toISOString(),
  };
}
