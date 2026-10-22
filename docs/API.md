# REST API

Base URL: `/api` (proxied same-origin by `packages/web/server.mjs`). All endpoints return
JSON. Authenticated endpoints require the `aether_session` HTTP-only cookie; **write**
requests must additionally send the `x-aether-csrf` header matching the `aether_csrf`
cookie (double-submit). Error shape:

```json
{ "error": { "code": "BAD_REQUEST", "message": "…", "details": { … } } }
```

Common codes: `BAD_REQUEST` (400), `UNAUTHORIZED` (401), `FORBIDDEN` (403),
`NOT_FOUND` (404), `CONFLICT` (409), `RATE_LIMITED` (429), `INTERNAL` (500 — message masked).

Validation is Zod on every body/query. Unknown fields are stripped.

---

## Health

| Method | Path | Auth | Description |
| --- | --- | --- | --- |
| GET | `/api/health` | – | `{status:'ok', uptime, ts}` |
| GET | `/api/ready` | – | Readiness (DB reachable) |
| GET | `/api/config` | – | Public feature flags (voice configured, OAuth, etc.) |

## Auth

| Method | Path | Auth | Description |
| --- | --- | --- | --- |
| POST | `/api/auth/register` | – | `{email, username, password, displayName?}` → creates user + session, sends verification email |
| POST | `/api/auth/login` | – | `{emailOrUsername, password}` → sets session + CSRF cookies |
| POST | `/api/auth/logout` | session | Clears session |
| POST | `/api/auth/verify` | – | `{token}` — verify email |
| POST | `/api/auth/resend-verification` | session | Re-sends verification email |
| POST | `/api/auth/forgot` | – | `{email}` → always 200 (no account enumeration) |
| POST | `/api/auth/reset` | – | `{token, password}` — resets password, revokes all sessions |
| POST | `/api/auth/google` | – | `{idToken}` — Google ID-token sign-in (optional; 503 when `GOOGLE_CLIENT_ID` unset) |
| GET | `/api/auth/me` | session | `{user: SelfUserDTO}` |
| GET | `/api/auth/sessions` | session | List active sessions |
| DELETE | `/api/auth/sessions` | session | Revoke all other sessions |
| DELETE | `/api/auth/sessions/:id` | session | Revoke one session |

## Users

| Method | Path | Auth | Description |
| --- | --- | --- | --- |
| PATCH | `/api/users/me` | session | `{displayName?, bio?, customStatus?}` |
| PATCH | `/api/users/me/account` | session | `{username?, currentPassword?, newPassword?}` — password change revokes other sessions |
| PATCH | `/api/users/me/privacy` | session | `{allowDmsFromFriendsOnly?, allowFriendRequests?, showPresenceToFriendsOnly?}` |
| PATCH | `/api/users/me/notifications` | session | `{dmNotifications?, mentionNotifications?, friendRequestNotifications?, mutedServerIds?}` |
| PATCH | `/api/users/me/presence` | session | `{status: ONLINE\|IDLE\|DND\|INVISIBLE\|OFFLINE}` |
| POST | `/api/users/me/avatar` | session | multipart `file` (PNG/JPEG/GIF/WebP) → `{user}` |
| DELETE | `/api/users/me` | session | Delete account |
| GET | `/api/users/:username` | – | Public profile |

## Servers

| Method | Path | Auth | Description |
| --- | --- | --- | --- |
| GET | `/api/servers` | session | `{servers: ServerDTO[]}` (with `myPermissions`, `unread`) |
| POST | `/api/servers` | session | `{name, description?}` — creator becomes owner with default channels/roles |
| GET | `/api/servers/:id` | member | `{server: ServerDTO}` |
| PATCH | `/api/servers/:id` | MANAGE_SERVER | `{name?, description?, iconUrl?}` |
| DELETE | `/api/servers/:id` | owner | Delete server |
| POST | `/api/servers/:id/leave` | member | Leave (owner must transfer/delete first) |
| GET | `/api/servers/:id/members` | member | `?limit&cursor` → `{members: ServerMemberDTO[], nextCursor}` |
| DELETE | `/api/servers/:id/members/:userId` | MANAGE_MEMBERS | Remove member (kick) |
| GET | `/api/servers/:id/roles` | member | `{roles: RoleDTO[]}` |
| POST | `/api/servers/:id/roles` | MANAGE_ROLES | `{name, permissions, color?, hoist?, mentionable?}` |
| PATCH | `/api/servers/:id/roles/:roleId` | MANAGE_ROLES | Update role |
| DELETE | `/api/servers/:id/roles/:roleId` | MANAGE_ROLES | Delete role |
| PUT | `/api/servers/:id/roles/:roleId/members/:userId` | MANAGE_ROLES | Assign/remove role |
| POST | `/api/servers/:id/invites` | MANAGE_INVITES | `{maxUses?, expiresAt?}` → `{invite}` |
| GET | `/api/servers/:id/invites` | MANAGE_INVITES | List invites |
| DELETE | `/api/invites/:code` | MANAGE_INVITES | Revoke invite |
| GET | `/api/invites/:code` | – | Preview `{invite: {code, serverName, inviterName, uses, …}}` |
| POST | `/api/invites/:code/join` | session | Join → `{serverId, alreadyMember}` (idempotent) |

## Channels

| Method | Path | Auth | Description |
| --- | --- | --- | --- |
| GET | `/api/servers/:id/channels` | VIEW_CHANNELS | `{categories: [{id,name,position,channels}], uncategorized, canManage}` (private channels omitted without access) |
| POST | `/api/servers/:id/channels` | MANAGE_CHANNELS | `{name, type, topic?, categoryId?, isPrivate?}` |
| PATCH | `/api/servers/:id/channels/reorder` | MANAGE_CHANNELS | `{order: [{channelId, categoryId?, position}]}` |
| POST | `/api/servers/:id/channels/categories` | MANAGE_CHANNELS | `{name}` |
| PATCH | `/api/servers/:id/channels/categories/:categoryId` | MANAGE_CHANNELS | Rename category |
| DELETE | `/api/servers/:id/channels/categories/:categoryId` | MANAGE_CHANNELS | Delete category |
| PATCH | `/api/channels/:channelId` | MANAGE_CHANNELS | `{name?, topic?, isPrivate?, categoryId?, position?}` |
| DELETE | `/api/channels/:channelId` | MANAGE_CHANNELS | Delete channel |
| PUT | `/api/channels/:channelId/overrides/:targetId` | MANAGE_CHANNELS | `{allow, deny}` for role or member |
| GET | `/api/channels/:channelId/messages` | VIEW_CHANNELS | `?cursor&limit&direction=before\|after` → `{items: MessageDTO[] (ascending), nextCursor}` |
| GET | `/api/channels/:channelId/pins` | VIEW_CHANNELS | Pinned messages |

## Messages

| Method | Path | Auth | Description |
| --- | --- | --- | --- |
| POST | `/api/messages` | SEND_MESSAGES | `{channelId, content?, replyToId?, attachmentIds?, clientId?}` (persisted before 201 ack) |
| GET | `/api/messages/:id` | viewer | Single message |
| PATCH | `/api/messages/:id` | author or MANAGE_MESSAGES | `{content}` |
| DELETE | `/api/messages/:id` | author or MANAGE_MESSAGES | Delete |
| POST | `/api/messages/:id/reactions` | SEND_MESSAGES | `{emoji}` — toggles |
| POST | `/api/messages/:id/pin` | PIN_MESSAGES | Pin |
| DELETE | `/api/messages/:id/pin` | PIN_MESSAGES | Unpin |

## Conversations (DMs & groups)

| Method | Path | Auth | Description |
| --- | --- | --- | --- |
| GET | `/api/conversations` | session | `{conversations: ConversationDTO[]}` with unread counts |
| POST | `/api/conversations/dm` | session | `{userId}` — creates or returns existing DM |
| POST | `/api/conversations/group` | session | `{name, memberIds[]}` |
| GET | `/api/conversations/:id` | member | `{conversation}` |
| GET | `/api/conversations/:id/messages` | member | `?cursor&limit` — same page contract as channels |
| POST | `/api/conversations/:id/messages` | member | `{content?, replyToId?, attachmentIds?, clientId?}` |
| PATCH | `/api/conversations/:id` | owner | `{name}` (groups) |
| POST | `/api/conversations/:id/members` | member | `{memberIds[]}` (groups) |
| DELETE | `/api/conversations/:id/members/me` | member | Leave conversation |
| POST | `/api/conversations/:id/read` | member | `{messageId?}` — mark read |

## Social (friends & blocks)

| Method | Path | Auth | Description |
| --- | --- | --- | --- |
| GET | `/api/friends` | session | `{friends, incoming, outgoing}` — `FriendDTO[]` |
| POST | `/api/friends/requests` | session | `{username}` |
| POST | `/api/friends/requests/:id/accept` | recipient | Accept |
| POST | `/api/friends/requests/:id/reject` | recipient | Decline |
| DELETE | `/api/friends/requests/:id` | sender | Cancel |
| DELETE | `/api/friends/:userId` | session | Remove friend |
| GET | `/api/friends/blocks` | session | `{blocked: PublicUserDTO[]}` |
| POST | `/api/friends/blocks` | session | `{userId}` |
| DELETE | `/api/friends/blocks/:userId` | session | Unblock |

## Notifications

| Method | Path | Auth | Description |
| --- | --- | --- | --- |
| GET | `/api/notifications` | session | `{notifications, unread}` |
| POST | `/api/notifications/:id/read` | session | Mark one read |
| POST | `/api/notifications/read-all` | session | Mark all read |

## Search

| Method | Path | Auth | Description |
| --- | --- | --- | --- |
| GET | `/api/search/messages` | session | `?q&serverId?&limit&cursor` — PG full-text search; results filtered by the caller's channel permissions |

## Uploads

| Method | Path | Auth | Description |
| --- | --- | --- | --- |
| POST | `/api/uploads` | session | multipart `file` → `{attachment}` (bind to a message via `attachmentIds`) |
| GET | `/api/uploads/:key` | viewer | Private attachment download (ownership or channel/conversation access) |

## Voice (LiveKit)

| Method | Path | Auth | Description |
| --- | --- | --- | --- |
| GET | `/api/voice/status` | – | `{configured: boolean}` — false until `LIVEKIT_*` env is set |
| POST | `/api/voice/token` | session | `{channelId}` → LiveKit access token (**503** `SERVICE_UNAVAILABLE` when not configured — never faked) |
| GET | `/api/voice/channels/:channelId/participants` | member | Current voice participants |

## Moderation

| Method | Path | Auth | Description |
| --- | --- | --- | --- |
| POST | `/api/moderation/actions` | KICK/BAN/MODERATE | `{type: KICK\|BAN\|UNBAN\|TIMEOUT, serverId, userId, durationMinutes?, reason?}` |
| GET | `/api/moderation/actions` | MODERATE_MEMBERS | Action history for a server |
| GET | `/api/moderation/reports` | MODERATE_MEMBERS | Report queue |
| PATCH | `/api/moderation/reports/:id` | MODERATE_MEMBERS | Review report |
| POST | `/api/reports` | session | `{serverId, messageId?, reason}` |
| GET | `/api/moderation/audit` | VIEW_AUDIT_LOG | Audit log entries |
