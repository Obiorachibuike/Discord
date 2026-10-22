# Socket.IO protocol

Connect to **`/socket.io` on the same web origin**, with browser cookies (`withCredentials: true`). The API process runs the Socket.IO server; the web server proxies upgrades. A valid **HTTP-only `cove_session`** is required—client-supplied `userId` or token strings are *not* authentication. WebSocket/polling handshakes with an unapproved `Origin` are rejected by Engine.IO even if a valid cookie is supplied. Connections without a valid session receive `connect_error: UNAUTHENTICATED`.

The server stores `userId` and `sessionId` after handshake and revalidates the session **on every incoming packet**. It disconnects on revocation or more than 100 client packets/10 seconds. For a horizontally scaled API, configure Redis so room broadcasts and disconnects propagate across processes. No Redis = one API instance only.

## Client → server (acknowledged)

All inputs are validated and all subscriptions/mutations recheck current permissions. Acknowledgement shape:

```json
{ "ok": true, "data": { "...": "event-specific result" } }
```

or

```json
{ "ok": false, "error": { "code": "NOT_FOUND", "message": "Channel not found." } }
```

| Event | Example payload | Behavior |
| --- | --- | --- |
| `server:subscribe` | `{ "serverId": "<uuid>" }` | Joined member subscribes to community-wide events; verified against DB. Joined communities are also rejoined on connection. |
| `channel:subscribe` | `{ "channelId": "<uuid>" }` | Requires current `VIEW_CHANNEL` (private channels are hidden). |
| `channel:unsubscribe` | `{ "channelId": "<uuid>" }` | Leave channel room. |
| `conversation:subscribe` | `{ "conversationId": "<uuid>" }` | Requires membership and no blocked pair. |
| `conversation:unsubscribe` | `{ "conversationId": "<uuid>" }` | Leave conversation room. |
| `message:send` | `{ "target": { "channelId": "<uuid>" }, "message": { "content": "Hello", "clientNonce": "<uuid>", "attachmentIds": [] } }` | Or use `{conversationId}` target. Writes DB before `ok`; data is `{message,deduplicated}`. Concurrent nonce retries cannot create two messages. |
| `message:edit` | `{ "messageId": "<uuid>", "content": "Correction" }` | Author only, cannot edit deleted message. |
| `message:delete` | `{ "messageId": "<uuid>" }` | Author or channel moderator with `DELETE_MESSAGES`; soft delete. |
| `reaction:toggle` | `{ "messageId": "<uuid>", "emoji": "💜" }` | Add/remove own reaction. |
| `typing:set` | `{ "target": { "conversationId": "<uuid>" }, "typing": true }` | Authorized, ephemeral; rate-throttled to one update ~700ms per socket. |
| `presence:heartbeat` | `{}` | Refresh live presence; browser sends every ~20 seconds. |

The `message:send` inner object accepts the same validated fields as REST: content ≤4000 chars, UUID nonce, up to five `attachmentIds`, optional `replyToId` within the same authorized conversation/channel. Sending more than 15 **new** messages per 10 seconds is rate-limited (Redis-backed if configured). For no or transient connection, the browser sends via REST and reconciles by persisted message ID/nonce. Client reconnects must resubscribe to active targets, then load history to recover missed events.

## Server → client

| Event | Audience / payload |
| --- | --- |
| `connection:ready` | Connecting socket `{userId}` after server rooms/presence initialize. Handlers are installed *before* this event, so immediate subscriptions are safe. |
| `message:created`, `message:updated` | Authorized channel or conversation subscribers: serialized persisted `Message`. |
| `message:deleted` | Target room: `{id,channelId? ,conversationId?}`; clients remove content/attachments from view. |
| `reaction:updated` | Target room: `{messageId,reactions:[{emoji,userId},...]}`. |
| `typing:updated` | Target room except originating socket: `{userId,targetId,kind,typing}`. Also sent with `typing:false` at disconnect. |
| `presence:updated` | Shared communities and accepted friends: `{userId,presence}` (Invisible appears Offline to others). |
| `notification:new` | Recipient user room: persisted notification record; fetch `/api/notifications` for durable state. |
| `membership:changed` | Community/user room: `{serverId}`; refetch authorized server/members. |
| `friend:updated` | Both affected user rooms: `{userId}`; refetch friend lists. |
| `conversation:updated` | Affected participant user rooms: `{conversationId}`; refetch conversations. |
| `profile:updated` | Own user room: sanitized public profile. |
| `voice:updated` | Subscribed channel/conversation after a **signed** LiveKit webhook: `{room,participantId,joined}`. Media travels through LiveKit, never these events. |
| `session:revoked` | Affected socket immediately before forced disconnect; client should clear UI caches and redirect to sign-in. |
| `moderation:updated` | Community room after a new report; moderators can refetch reports. |

Events are *hints*, not the authoritative state. Authorization is enforced again on each REST read or socket operation, and session/permission changes can revoke delivery. Socket.IO acknowledgements are not a replacement for PostgreSQL commits. Incoming server errors use stable codes and sanitized messages, never stack traces.
