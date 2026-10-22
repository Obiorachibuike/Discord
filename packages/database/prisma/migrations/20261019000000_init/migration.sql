-- Initial schema for Aether.
-- Applied by packages/database/src/migrate.ts (compatible with `prisma migrate deploy`).

-- ─── Enums ───────────────────────────────────────────────────────────────────
CREATE TYPE "PresenceStatus" AS ENUM ('ONLINE', 'IDLE', 'DND', 'INVISIBLE', 'OFFLINE');
CREATE TYPE "VerificationType" AS ENUM ('EMAIL_VERIFY', 'PASSWORD_RESET');
CREATE TYPE "ChannelType" AS ENUM ('TEXT', 'VOICE', 'ANNOUNCEMENT');
CREATE TYPE "FriendRequestStatus" AS ENUM ('PENDING', 'ACCEPTED', 'REJECTED', 'CANCELLED');
CREATE TYPE "ConversationType" AS ENUM ('DIRECT', 'GROUP');
CREATE TYPE "NotificationType" AS ENUM ('DM', 'MENTION', 'FRIEND_REQUEST', 'FRIEND_ACCEPTED', 'INVITE', 'MODERATION');
CREATE TYPE "ModerationActionType" AS ENUM ('KICK', 'BAN', 'UNBAN', 'TIMEOUT', 'UNTIMEOUT', 'DELETE_MESSAGE', 'WARN');
CREATE TYPE "ReportStatus" AS ENUM ('OPEN', 'RESOLVED', 'DISMISSED');

-- ─── User & auth ─────────────────────────────────────────────────────────────
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "emailVerifiedAt" TIMESTAMP(3),
    "username" TEXT NOT NULL,
    "displayName" TEXT NOT NULL,
    "avatarUrl" TEXT,
    "bio" TEXT,
    "customStatus" TEXT,
    "presenceStatus" "PresenceStatus" NOT NULL DEFAULT 'OFFLINE',
    "passwordHash" TEXT,
    "privacySettings" JSONB NOT NULL DEFAULT '{"allowDmsFromFriendsOnly":false,"allowFriendRequests":true,"showPresenceToFriendsOnly":false}',
    "notificationSettings" JSONB NOT NULL DEFAULT '{"dmNotifications":true,"mentionNotifications":true,"friendRequestNotifications":true,"mutedServerIds":[]}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");
CREATE UNIQUE INDEX "User_username_key" ON "User"("username");
CREATE INDEX "User_presenceStatus_idx" ON "User"("presenceStatus");

CREATE TABLE "Account" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "providerAccountId" TEXT NOT NULL,
    "accessToken" TEXT,
    "refreshToken" TEXT,
    "expiresAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Account_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "Account_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "Account_provider_providerAccountId_key" ON "Account"("provider", "providerAccountId");
CREATE INDEX "Account_userId_idx" ON "Account"("userId");

CREATE TABLE "Session" (
    "id" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "userAgent" TEXT,
    "ip" TEXT,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "revokedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Session_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "Session_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "Session_tokenHash_key" ON "Session"("tokenHash");
CREATE INDEX "Session_userId_idx" ON "Session"("userId");
CREATE INDEX "Session_expiresAt_idx" ON "Session"("expiresAt");

CREATE TABLE "VerificationToken" (
    "id" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "type" "VerificationType" NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "usedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "VerificationToken_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "VerificationToken_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "VerificationToken_tokenHash_key" ON "VerificationToken"("tokenHash");
CREATE INDEX "VerificationToken_userId_type_idx" ON "VerificationToken"("userId", "type");

-- ─── Servers ─────────────────────────────────────────────────────────────────
CREATE TABLE "Server" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "iconUrl" TEXT,
    "ownerId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "Server_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "Server_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE INDEX "Server_ownerId_idx" ON "Server"("ownerId");

CREATE TABLE "ServerMember" (
    "id" TEXT NOT NULL,
    "serverId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "nickname" TEXT,
    "timeoutUntil" TIMESTAMP(3),
    "joinedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ServerMember_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "ServerMember_serverId_fkey" FOREIGN KEY ("serverId") REFERENCES "Server"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "ServerMember_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "ServerMember_serverId_userId_key" ON "ServerMember"("serverId", "userId");
CREATE INDEX "ServerMember_userId_idx" ON "ServerMember"("userId");

CREATE TABLE "Role" (
    "id" TEXT NOT NULL,
    "serverId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "color" TEXT,
    "permissions" BIGINT NOT NULL DEFAULT 0,
    "position" INTEGER NOT NULL DEFAULT 0,
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Role_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "Role_serverId_fkey" FOREIGN KEY ("serverId") REFERENCES "Server"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "Role_serverId_name_key" ON "Role"("serverId", "name");
CREATE INDEX "Role_serverId_position_idx" ON "Role"("serverId", "position");

CREATE TABLE "MemberRole" (
    "roleId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "serverId" TEXT NOT NULL,
    CONSTRAINT "MemberRole_pkey" PRIMARY KEY ("roleId", "userId"),
    CONSTRAINT "MemberRole_roleId_fkey" FOREIGN KEY ("roleId") REFERENCES "Role"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "MemberRole_serverId_userId_fkey" FOREIGN KEY ("serverId", "userId") REFERENCES "ServerMember"("serverId", "userId") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "MemberRole_userId_idx" ON "MemberRole"("userId");

-- ─── Channels ────────────────────────────────────────────────────────────────
CREATE TABLE "ChannelCategory" (
    "id" TEXT NOT NULL,
    "serverId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "position" INTEGER NOT NULL DEFAULT 0,
    CONSTRAINT "ChannelCategory_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "ChannelCategory_serverId_fkey" FOREIGN KEY ("serverId") REFERENCES "Server"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "ChannelCategory_serverId_position_idx" ON "ChannelCategory"("serverId", "position");

CREATE TABLE "Channel" (
    "id" TEXT NOT NULL,
    "serverId" TEXT NOT NULL,
    "categoryId" TEXT,
    "name" TEXT NOT NULL,
    "type" "ChannelType" NOT NULL DEFAULT 'TEXT',
    "topic" TEXT,
    "position" INTEGER NOT NULL DEFAULT 0,
    "isPrivate" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Channel_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "Channel_serverId_fkey" FOREIGN KEY ("serverId") REFERENCES "Server"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Channel_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "ChannelCategory"("id") ON DELETE SET NULL ON UPDATE CASCADE
);
CREATE INDEX "Channel_serverId_position_idx" ON "Channel"("serverId", "position");
CREATE INDEX "Channel_serverId_categoryId_idx" ON "Channel"("serverId", "categoryId");

CREATE TABLE "ChannelPermissionOverride" (
    "id" TEXT NOT NULL,
    "channelId" TEXT NOT NULL,
    "roleId" TEXT,
    "userId" TEXT,
    "allow" BIGINT NOT NULL DEFAULT 0,
    "deny" BIGINT NOT NULL DEFAULT 0,
    CONSTRAINT "ChannelPermissionOverride_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "ChannelPermissionOverride_channelId_fkey" FOREIGN KEY ("channelId") REFERENCES "Channel"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "ChannelPermissionOverride_roleId_fkey" FOREIGN KEY ("roleId") REFERENCES "Role"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "ChannelPermissionOverride_channelId_roleId_key" ON "ChannelPermissionOverride"("channelId", "roleId");
CREATE UNIQUE INDEX "ChannelPermissionOverride_channelId_userId_key" ON "ChannelPermissionOverride"("channelId", "userId");

CREATE TABLE "Invitation" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "serverId" TEXT NOT NULL,
    "inviterId" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3),
    "maxUses" INTEGER,
    "uses" INTEGER NOT NULL DEFAULT 0,
    "revokedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Invitation_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "Invitation_serverId_fkey" FOREIGN KEY ("serverId") REFERENCES "Server"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "Invitation_code_key" ON "Invitation"("code");
CREATE INDEX "Invitation_serverId_idx" ON "Invitation"("serverId");

-- ─── Conversations (created before Message for FK order) ──────────────────────────
CREATE TABLE "Conversation" (
    "id" TEXT NOT NULL,
    "type" "ConversationType" NOT NULL,
    "name" TEXT,
    "creatorId" TEXT,
    "directKey" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "Conversation_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "Conversation_creatorId_fkey" FOREIGN KEY ("creatorId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "Conversation_directKey_key" ON "Conversation"("directKey");

CREATE TABLE "ConversationMember" (
    "id" TEXT NOT NULL,
    "conversationId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "joinedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "role" TEXT NOT NULL DEFAULT 'member',
    CONSTRAINT "ConversationMember_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "ConversationMember_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "Conversation"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "ConversationMember_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "ConversationMember_conversationId_userId_key" ON "ConversationMember"("conversationId", "userId");
CREATE INDEX "ConversationMember_userId_idx" ON "ConversationMember"("userId");

CREATE TABLE "ConversationReadState" (
    "userId" TEXT NOT NULL,
    "conversationId" TEXT NOT NULL,
    "lastReadAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastReadMessageId" TEXT,
    CONSTRAINT "ConversationReadState_pkey" PRIMARY KEY ("userId", "conversationId"),
    CONSTRAINT "ConversationReadState_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "ConversationReadState_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "Conversation"("id") ON DELETE CASCADE ON UPDATE CASCADE
);


-- ─── Messaging ───────────────────────────────────────────────────────────────
CREATE TABLE "Message" (
    "id" TEXT NOT NULL,
    "channelId" TEXT,
    "conversationId" TEXT,
    "authorId" TEXT NOT NULL,
    "content" TEXT NOT NULL DEFAULT '',
    "replyToId" TEXT,
    "clientId" TEXT,
    "editedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "searchVector" tsvector,
    CONSTRAINT "Message_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "Message_channelId_fkey" FOREIGN KEY ("channelId") REFERENCES "Channel"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Message_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "Conversation"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Message_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Message_replyToId_fkey" FOREIGN KEY ("replyToId") REFERENCES "Message"("id") ON DELETE SET NULL ON UPDATE CASCADE
);
CREATE INDEX "Message_channelId_createdAt_idx" ON "Message"("channelId", "createdAt");
CREATE INDEX "Message_conversationId_createdAt_idx" ON "Message"("conversationId", "createdAt");
CREATE INDEX "Message_authorId_createdAt_idx" ON "Message"("authorId", "createdAt");
CREATE UNIQUE INDEX "Message_channelId_authorId_clientId_key" ON "Message"("channelId", "authorId", "clientId");
CREATE INDEX "Message_searchVector_idx" ON "Message" USING GIN ("searchVector");

-- Full-text search vector maintenance.
CREATE OR REPLACE FUNCTION message_search_vector_update() RETURNS trigger AS $$
BEGIN
  NEW."searchVector" := to_tsvector('simple', COALESCE(NEW."content", ''));
  RETURN NEW;
END
$$ LANGUAGE plpgsql;

CREATE TRIGGER message_search_vector_trigger
  BEFORE INSERT OR UPDATE OF "content" ON "Message"
  FOR EACH ROW EXECUTE FUNCTION message_search_vector_update();

CREATE TABLE "MessageAttachment" (
    "id" TEXT NOT NULL,
    "messageId" TEXT,
    "fileName" TEXT NOT NULL,
    "fileSize" INTEGER NOT NULL,
    "mimeType" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "storageKey" TEXT NOT NULL,
    "url" TEXT,
    "width" INTEGER,
    "height" INTEGER,
    CONSTRAINT "MessageAttachment_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "MessageAttachment_messageId_fkey" FOREIGN KEY ("messageId") REFERENCES "Message"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "MessageAttachment_messageId_idx" ON "MessageAttachment"("messageId");

CREATE TABLE "MessageReaction" (
    "id" TEXT NOT NULL,
    "messageId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "emoji" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "MessageReaction_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "MessageReaction_messageId_fkey" FOREIGN KEY ("messageId") REFERENCES "Message"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "MessageReaction_messageId_userId_emoji_key" ON "MessageReaction"("messageId", "userId", "emoji");
CREATE INDEX "MessageReaction_messageId_idx" ON "MessageReaction"("messageId");

CREATE TABLE "MessagePin" (
    "id" TEXT NOT NULL,
    "messageId" TEXT NOT NULL,
    "channelId" TEXT NOT NULL,
    "pinnedById" TEXT NOT NULL,
    "pinnedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "MessagePin_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "MessagePin_messageId_fkey" FOREIGN KEY ("messageId") REFERENCES "Message"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "MessagePin_channelId_fkey" FOREIGN KEY ("channelId") REFERENCES "Channel"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "MessagePin_messageId_key" ON "MessagePin"("messageId");

CREATE TABLE "ChannelReadState" (
    "userId" TEXT NOT NULL,
    "channelId" TEXT NOT NULL,
    "lastReadAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastReadMessageId" TEXT,
    CONSTRAINT "ChannelReadState_pkey" PRIMARY KEY ("userId", "channelId"),
    CONSTRAINT "ChannelReadState_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "ChannelReadState_channelId_fkey" FOREIGN KEY ("channelId") REFERENCES "Channel"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- ─── Social ──────────────────────────────────────────────────────────────────
CREATE TABLE "FriendRequest" (
    "id" TEXT NOT NULL,
    "senderId" TEXT NOT NULL,
    "recipientId" TEXT NOT NULL,
    "status" "FriendRequestStatus" NOT NULL DEFAULT 'PENDING',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "respondedAt" TIMESTAMP(3),
    CONSTRAINT "FriendRequest_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "FriendRequest_senderId_fkey" FOREIGN KEY ("senderId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "FriendRequest_recipientId_fkey" FOREIGN KEY ("recipientId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "FriendRequest_senderId_recipientId_key" ON "FriendRequest"("senderId", "recipientId");
CREATE INDEX "FriendRequest_recipientId_status_idx" ON "FriendRequest"("recipientId", "status");

CREATE TABLE "UserBlock" (
    "id" TEXT NOT NULL,
    "blockerId" TEXT NOT NULL,
    "blockedId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "UserBlock_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "UserBlock_blockerId_fkey" FOREIGN KEY ("blockerId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "UserBlock_blockedId_fkey" FOREIGN KEY ("blockedId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "UserBlock_blockerId_blockedId_key" ON "UserBlock"("blockerId", "blockedId");

-- ─── Notifications & moderation ──────────────────────────────────────────────
CREATE TABLE "Notification" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "type" "NotificationType" NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "data" JSONB NOT NULL DEFAULT '{}',
    "readAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Notification_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "Notification_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "Notification_userId_readAt_idx" ON "Notification"("userId", "readAt");
CREATE INDEX "Notification_userId_createdAt_idx" ON "Notification"("userId", "createdAt");

CREATE TABLE "ModerationAction" (
    "id" TEXT NOT NULL,
    "serverId" TEXT NOT NULL,
    "actorId" TEXT NOT NULL,
    "targetUserId" TEXT NOT NULL,
    "type" "ModerationActionType" NOT NULL,
    "reason" TEXT,
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ModerationAction_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "ModerationAction_serverId_fkey" FOREIGN KEY ("serverId") REFERENCES "Server"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "ModerationAction_serverId_createdAt_idx" ON "ModerationAction"("serverId", "createdAt");
CREATE INDEX "ModerationAction_serverId_targetUserId_idx" ON "ModerationAction"("serverId", "targetUserId");

CREATE TABLE "ModerationReport" (
    "id" TEXT NOT NULL,
    "serverId" TEXT,
    "reporterId" TEXT NOT NULL,
    "reportedUserId" TEXT,
    "messageId" TEXT,
    "reason" TEXT NOT NULL,
    "status" "ReportStatus" NOT NULL DEFAULT 'OPEN',
    "reviewedById" TEXT,
    "reviewNote" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "ModerationReport_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "ModerationReport_serverId_fkey" FOREIGN KEY ("serverId") REFERENCES "Server"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "ModerationReport_status_createdAt_idx" ON "ModerationReport"("status", "createdAt");
CREATE INDEX "ModerationReport_serverId_status_idx" ON "ModerationReport"("serverId", "status");

CREATE TABLE "AuditLog" (
    "id" TEXT NOT NULL,
    "serverId" TEXT,
    "actorId" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "targetId" TEXT,
    "targetType" TEXT,
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "AuditLog_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "AuditLog_serverId_fkey" FOREIGN KEY ("serverId") REFERENCES "Server"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "AuditLog_serverId_createdAt_idx" ON "AuditLog"("serverId", "createdAt");

CREATE TABLE "BanEntry" (
    "id" TEXT NOT NULL,
    "serverId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "reason" TEXT,
    "bannedById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "BanEntry_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "BanEntry_serverId_userId_key" ON "BanEntry"("serverId", "userId");
