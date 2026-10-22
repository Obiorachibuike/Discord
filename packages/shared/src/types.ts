/** Wire-format DTOs shared between API and clients. */

export interface PublicUserDTO {
  id: string;
  username: string;
  displayName: string;
  avatarUrl: string | null;
  bio?: string | null;
  customStatus?: string | null;
  presenceStatus?: 'ONLINE' | 'IDLE' | 'DND' | 'INVISIBLE' | 'OFFLINE';
  createdAt?: string;
}

export interface SelfUserDTO extends PublicUserDTO {
  email: string;
  emailVerified: boolean;
  privacy: {
    allowDmsFromFriendsOnly: boolean;
    allowFriendRequests: boolean;
    showPresenceToFriendsOnly: boolean;
  };
  notifications: {
    dmNotifications: boolean;
    mentionNotifications: boolean;
    friendRequestNotifications: boolean;
    mutedServerIds: string[];
  };
}

export interface AttachmentDTO {
  id: string;
  fileName: string;
  fileSize: number;
  mimeType: string;
  kind: 'image' | 'video' | 'audio' | 'file';
  url: string;
  width?: number | null;
  height?: number | null;
}

export interface ReactionDTO {
  emoji: string;
  count: number;
  me: boolean;
  userIds: string[];
}

export interface MessageDTO {
  id: string;
  channelId?: string | null;
  conversationId?: string | null;
  content: string;
  author: PublicUserDTO;
  replyTo?: { id: string; content: string; author: PublicUserDTO } | null;
  attachments: AttachmentDTO[];
  reactions: ReactionDTO[];
  pinned: boolean;
  editedAt: string | null;
  createdAt: string;
  clientId?: string | null;
}

export interface ChannelDTO {
  id: string;
  serverId: string;
  categoryId: string | null;
  name: string;
  type: 'TEXT' | 'VOICE' | 'ANNOUNCEMENT';
  topic: string | null;
  position: number;
  isPrivate: boolean;
  voiceParticipants?: VoiceParticipantDTO[];
}

export interface VoiceParticipantDTO {
  userId: string;
  user: PublicUserDTO;
  muted: boolean;
  deafened: boolean;
  speaking: boolean;
  videoOn: boolean;
  screenSharing: boolean;
  connectedAt: string;
}

export interface CategoryDTO {
  id: string;
  name: string;
  position: number;
  channels: ChannelDTO[];
}

export interface ServerDTO {
  id: string;
  name: string;
  description: string | null;
  iconUrl: string | null;
  ownerId: string;
  memberCount: number;
  myPermissions: string;
  unread?: number;
}

export interface ServerMemberDTO {
  userId: string;
  user: PublicUserDTO;
  roleIds: string[];
  nickname: string | null;
  joinedAt: string;
  timeoutUntil?: string | null;
}

export interface RoleDTO {
  id: string;
  name: string;
  color: string | null;
  permissions: string;
  position: number;
  isDefault: boolean;
}

export interface InvitationDTO {
  code: string;
  serverId: string;
  serverName: string;
  serverIconUrl: string | null;
  inviterName: string;
  expiresAt: string | null;
  maxUses: number | null;
  uses: number;
}

export interface ConversationDTO {
  id: string;
  type: 'DIRECT' | 'GROUP';
  name: string | null;
  memberCount: number;
  members: PublicUserDTO[];
  lastMessage?: { content: string; createdAt: string; authorName: string } | null;
  unread: number;
  updatedAt: string;
}

export interface FriendDTO {
  id: string;
  user: PublicUserDTO;
  status: 'ACCEPTED' | 'PENDING_INCOMING' | 'PENDING_OUTGOING';
  createdAt: string;
}

export interface NotificationDTO {
  id: string;
  type:
    | 'DM'
    | 'MENTION'
    | 'FRIEND_REQUEST'
    | 'FRIEND_ACCEPTED'
    | 'INVITE'
    | 'MODERATION';
  title: string;
  body: string;
  data: Record<string, unknown>;
  readAt: string | null;
  createdAt: string;
}

export interface ApiErrorBody {
  error: {
    code: string;
    message: string;
    details?: unknown;
    requestId?: string;
  };
}
