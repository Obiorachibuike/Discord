# Socket.IO Event Contract

Client: `packages/web/src/lib/socket.ts` (socket.io-client singleton).
Server: `packages/server/src/socket/`.
Shared TS types + Zod payload schemas: `packages/shared/src/events.ts`.

Authenticating: the socket handshake carries the `aether_session` cookie; unauthenticated
sockets receive `error` and are disconnected. Every client event payload is validated with
Zod; invalid payloads yield an `error` event and are ignored.

## Rooms

| Room | Joined by |
| --- | --- |
| `user:<id>` | every connection (personal events: notifications, friend requests) |
| `server:<id>` | members, on connect |
| `channel:<id>` | explicit `channel:subscribe` (subject to channel permissions) |
| `conversation:<id>` | explicit `conversation:subscribe` (subject to membership) |

**Registration order matters**: the server registers all `socket.on(...)` handlers
synchronously at connection time and only then performs async room joins + `ready`.
Registering after `await`s silently drops events the client emits immediately after connect.

## Client → Server

| Event | Payload | Notes |
| --- | --- | --- |
| `ping` | – | answered with `pong` |
| `presence:update` | `{status}` | ONLINE/IDLE/DND/INVISIBLE/OFFLINE |
| `channel:subscribe` | `{channelId}` | requires VIEW_CHANNELS; acks `error` when denied |
| `channel:unsubscribe` | `{channelId}` | |
| `conversation:subscribe` | `{conversationId}` | requires membership |
| `conversation:unsubscribe` | `{conversationId}` | |
| `message:create` | `{channelId \| conversationId, content?, replyToId?, attachmentIds?, clientId?}` | persisted **before** broadcast; `clientId` dedups |
| `message:update` | `{messageId, content}` | author or MANAGE_MESSAGES |
| `message:delete` | `{messageId}` | author or MANAGE_MESSAGES |
| `message:react` | `{messageId, emoji}` | toggle |
| `typing:start` | `{channelId}` | ephemeral |
| `typing:stop` | `{channelId}` | ephemeral |
| `conversation:typing:start` | `{conversationId}` | ephemeral |
| `conversation:typing:stop` | `{conversationId}` | ephemeral |
| `readstate:update` | `{channelId?, conversationId?, messageId?}` | marks read |
| `voice:state` | `{channelId, speaking?, muted?, video?, screen?}` | relayed to voice participants |

## Server → Client

| Event | Payload | Notes |
| --- | --- | --- |
| `ready` | `{userId, sessionId}` | handshake complete — safe to subscribe/emit |
| `pong` | – | |
| `error` | `{code, message}` | validation/auth failures |
| `message:created` | `MessageDTO` | delivered to channel/conversation room |
| `message:updated` | `MessageDTO` | |
| `message:deleted` | `{id, channelId?, conversationId?}` | |
| `message:reaction` | `{messageId, reactions}` | |
| `typing:changed` | `{userId, displayName, typing, channelId?, conversationId?}` | exactly one of channel/conversation |
| `presence:update` | `{userId, status}` | friends + server peers |
| `notification:new` | `NotificationDTO` | to `user:<id>` |
| `friend:request` | `{requestId, user}` | to recipient |
| `friend:updated` | `{requestId, status, user}` | both parties |
| `conversation:created` | `ConversationDTO` | members |
| `conversation:updated` | `ConversationDTO` | members |
| `channel:updated` | `ChannelDTO` | server room |
| `channel:deleted` | `{id, serverId}` | server room |
| `member:updated` | `ServerMemberDTO` | server room (roles/nickname/timeout) |
| `moderation:update` | `{type, serverId, userId}` | kick/ban/timeout victims + staff |
| `voice:participants` | `{channelId, participants[]}` | server room |
| `readstate:updated` | `{channelId?, conversationId?, lastReadMessageId}` | own user room |

## Delivery guarantees

- **Messages**: persisted to PostgreSQL first; the broadcast only carries DB-confirmed
  messages. Duplicate suppression on the client by `message.id` and optimistic `clientId`.
- **Typing/presence**: best-effort, ephemeral — no persistence, no replay.
- **Ordering**: per-room broadcast order is preserved by Socket.IO; clients reconcile with
  the REST pagination contract (`items` ascending).
- **Reconnect**: the client re-subscribes via `useChannelSocket` / `useConversationSocket`
  effects and refetches caches through TanStack Query invalidation.
