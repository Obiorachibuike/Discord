# HTTP API

Base: **`/api` on the web origin**. REST responses are JSON except downloads, redirects, and `204 No Content`. UUID path parameters are validated. Use `Content-Type: application/json` for JSON mutations; upload via `multipart/form-data`. Browser clients should use relative paths, not the private API port.

## Sessions, CSRF and errors

`POST /api/auth/register` accepts `{email, username, displayName, password}`; `POST /api/auth/login` accepts `{email,password}`. Passwords are at least 12 characters. Successful login/eligible local registration sets `cove_session` (**HttpOnly**, Secure in production, SameSite=Lax) and `cove_csrf` (readable, SameSite=Lax). The session is opaque; its hash is in PostgreSQL. Never store credentials or tokens in `localStorage`. Registration of an existing identity returns a generic `202`, not an account-existence oracle.

All mutations **with an authenticated session** must include `x-csrf-token` equal to `cove_csrf`. This also applies to logout and bodyless `POST`/`DELETE`. Requests with an `Origin` not in `WEB_ORIGIN` (or the configured development preview origin) are rejected. Cross-origin browser requests require explicit CORS permission; same-origin proxying is preferred. Public registration/login and public invite previews do not require an existing CSRF token.

```http
POST /api/messages/channels/<channel-uuid>
Content-Type: application/json
Cookie: cove_session=<opaque>; cove_csrf=<random>
x-csrf-token: <same random value as cove_csrf>

{"content":"Hi @sam!","attachmentIds":[],"clientNonce":"<new UUID>"}
```

`201 {"message": { ... }, "deduplicated": false}` after persistence. Repeating **the same** nonce/payload returns the original message with `deduplicated: true`; reusing it for a different payload returns `409 NONCE_CONFLICT`. On failure responses have `{"error":{"code":"...","message":"..."},"requestId":"..."}`; validation failures may also include `fields`. Typical codes: `UNAUTHENTICATED` (401), `CSRF_FAILED`/`FORBIDDEN` (403), `NOT_FOUND` (404, also masks inaccessible private channels), `CONFLICT` (409), `RATE_LIMITED` (429), `LIVEKIT_UNAVAILABLE` / `EMAIL_UNAVAILABLE` (503). Stack traces and secrets are not returned.

## Route inventory

`{serverId}`, `{channelId}`, `{conversationId}`, `{messageId}`, `{userId}`, `{roleId}` and `{token}` below are path parameters. Unless marked public, every route requires an authenticated session; the corresponding permission is enforced server-side.

### Service/identity

| Method and path | Purpose |
| --- | --- |
| `GET /health`, `GET /ready` | Liveness; readiness also checks PostgreSQL and configured Redis (both public) |
| `GET /auth/providers` | Public flags: configured Google OAuth, email-verification requirement |
| `POST /auth/register`, `POST /auth/login` | Create account / sign in |
| `GET /auth/me`, `POST /auth/logout` | Current account / revoke current session |
| `GET /auth/sessions`, `DELETE /auth/sessions/{id}` | View/revoke own device sessions |
| `POST /auth/resend-verification`, `POST /auth/verify` | One-time email verification (generic resend response) |
| `POST /auth/forgot-password`, `POST /auth/reset-password` | One-time expiring reset; configured SMTP required |
| `GET /auth/google`, `GET /auth/google/callback` | Optional Google OAuth 2.0 code+PKCE with signed state cookie; redirects; unavailable when unconfigured |
| `GET /users/me`, `PATCH /users/me`, `GET /users/{userId}` | Private profile update / limited public profile |
| `GET /presence?ids=uuid,uuid` | Presence for self, friends or shared community members (max 100 IDs) |

### Communities, roles and channels

| Method and path | Purpose |
| --- | --- |
| `GET /servers`, `POST /servers`, `GET /servers/{serverId}`, `PATCH /servers/{serverId}` | List/joined community, create, get authorized view, edit |
| `DELETE /servers/{serverId}` | Owner only; body `{ "confirmName": "exact community name" }` |
| `POST /servers/{serverId}/transfer`, `POST /servers/{serverId}/leave` | Transfer ownership with `{userId}` / leave (owner must transfer first) |
| `GET /servers/{serverId}/members`, `GET /servers/{serverId}/roles` | Member/role listings |
| `POST /servers/{serverId}/roles`; `PATCH/DELETE /servers/{serverId}/roles/{roleId}` | Create/edit/delete role |
| `PUT/DELETE /servers/{serverId}/members/{userId}/roles/{roleId}` | Assign/remove role with hierarchy checks |
| `GET/POST /servers/{serverId}/invites`, `DELETE /servers/{serverId}/invites/{inviteId}` | List metadata, issue/revoke invitation. **Raw token is returned only at creation.** |
| `GET /invites/{token}`, `POST /invites/{token}/accept` | Public preview / authenticated single-use-aware acceptance |
| `GET /channels/{channelId}`, `POST /channels/servers/{serverId}` | Authorized channel lookup / create |
| `PATCH/DELETE /channels/{channelId}` | Edit/delete channel (manage channels) |
| `POST /channels/servers/{serverId}/categories`, `PATCH/DELETE /channels/categories/{categoryId}` | Organize categories |
| `GET/PUT /channels/{channelId}/overrides` | View/set a role or user allow/deny override |

Creating a community provisions Owner, Administrator, Moderator and Member roles and welcome/general/voice starter channels. A private channel is visible only after explicit `VIEW_CHANNEL` allowance or `MANAGE_CHANNELS`. Non-owners cannot grant permissions above their own or modify higher roles. Invites accept `{maxUses?: number|null, expiresInHours?: number|null}` (ranges: 1–1000 uses, 1–720 hours); disabled/expired/exhausted tokens return an error. The server handles concurrent acceptances transactionally.

### Conversations, messages and search

| Method and path | Purpose |
| --- | --- |
| `GET /social/friends`, `POST /social/friends/requests` | List friends/pending/blocked; send request by `{username}` |
| `POST /social/friends/requests/{requestId}/accept`; `DELETE /social/friends/requests/{requestId}` | Accept or cancel/decline request |
| `DELETE /social/friends/{userId}`, `POST/DELETE /social/blocks/{userId}` | Remove friend, block/unblock |
| `GET/POST /social/conversations` | List latest 100 joined DMs/groups; create `{kind:"DIRECT"|"GROUP",participantIds:[...],name?}` |
| `GET/PATCH /social/conversations/{conversationId}` | Get members / rename authorized group |
| `POST /social/conversations/{conversationId}/members`, `POST /social/conversations/{conversationId}/leave` | Group membership / leave |
| `POST /social/conversations/{conversationId}/read` | Advance personal read timestamp |
| `GET/POST /messages/channels/{channelId}` | History / send in permitted text or announcement channel |
| `GET/POST /messages/conversations/{conversationId}` | History / send to joined, unblocked DM/group |
| `PATCH/DELETE /messages/{messageId}` | Author edit / author or permitted moderator soft-delete |
| `POST /messages/{messageId}/reactions`, `POST /messages/{messageId}/pin` | Toggle reaction or permitted channel pin |
| `GET /messages/channels/{channelId}/pins` | Recent pinned messages |
| `GET /messages/search?q=...` | Authorized channel search only |

Messages have `content` (0–4000 characters), a **UUID `clientNonce`**, optional `replyToId`, and up to five `attachmentIds`. At least content or an attachment is required. Histories return `{"messages":[...],"nextCursor":"..."|null}`, ordered newest first. `?limit=1..50&cursor=<returned cursor>` retrieves older entries; the cursor encodes `(createdAt,id)` and is validated. Member, notification, audit and moderation lists also support `limit`/`cursor`. Search uses `q` (2–100 chars), optional `serverId`, `channelId`, `authorId`, `from`, `to`, `page` (0–100) and `limit` (1–30); response has `results` (including `serverId` for navigation) and `nextPage`. Search is PostgreSQL full-text, not an external index and not DM search.

### Files, notices, moderation and calls

| Method and path | Purpose |
| --- | --- |
| `POST /attachments` | Single `file` multipart upload; returns metadata and `/api/attachments/{id}` |
| `GET /attachments/{id}` | Check access, stream local file or redirect to short-lived signed object URL |
| `GET /notifications`, `POST /notifications/read-all`, `POST /notifications/{id}/read` | In-app notices, unread count and read markers |
| `POST /servers/{serverId}/members/{userId}/kick`, `.../ban`, `.../timeout` | Permission/hierarchy-checked moderation |
| `GET /servers/{serverId}/bans`, `DELETE /servers/{serverId}/bans/{userId}`, `GET /servers/{serverId}/audit` | Ban and audit management |
| `POST /moderation/reports`, `GET /moderation/servers/{serverId}/reports`, `PATCH /moderation/servers/{serverId}/reports/{reportId}`, `GET /moderation/servers/{serverId}/history` | File/review reports and moderation history |
| `POST /calls/channels/{channelId}/token`, `GET /calls/channels/{channelId}/participants` | Authorized LiveKit voice-room token / participants |
| `POST /calls/conversations/{conversationId}/token` | Authorized LiveKit direct/group call token |
| `POST /calls/webhook` | Signed raw LiveKit webhook; **not** a browser-session route |

Uploads are capped by `MAX_UPLOAD_MB` (default 10 MB), five attachments per message, 100 uploads/100 MB per user/day, and a detected MIME/extension allowlist: PNG/JPEG/WebP/GIF, PDF, DOCX, UTF-8 TXT/MD/CSV, MP4/WebM. Uploaded blobs are private even when guessed by ID. Reports must reference a target in an authorized community. Call-token routes use room-scoped LiveKit JWTs; if LiveKit is not configured they return `503`, never a fake room.
