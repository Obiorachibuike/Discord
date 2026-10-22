# Architecture

## Runtime and boundaries

```text
Browser (React/Next App Router + TanStack Query)
  │ same-origin HTTP + WebSocket, HTTP-only session cookie
  ▼
apps/web/server.mjs (Next 16 + /api and /socket.io reverse proxy)
  ├── pages, assets, app-shell UI
  └── apps/api (Express REST + authenticated Socket.IO)
         ├── packages/shared (Zod request contracts / permission names)
         ├── packages/db (Prisma 6 client + @prisma/adapter-pg) ── PostgreSQL 16
         ├── optional Redis ── Socket.IO adapter, presence, rate limits, BullMQ
         ├── optional SMTP and Google OAuth
         ├── local-dev / Cloudinary / S3-compatible object storage
         └── optional LiveKit token/room service ── media between clients and LiveKit
```

PostgreSQL is the **source of truth** for users, hashed sessions/invites, community membership, roles, overrides, messages, read state, attachments, notifications, bans, reports and audit events. There are no in-memory message substitutes. In-memory maps are used *only* for ephemeral single-process presence and message-rate windows when Redis is absent. React Query caches UI data and listens for events, but a refresh reloads it from the API.

### Write/read path

1. The browser uses relative `/api/...` URLs. `apps/web/server.mjs` forwards API traffic and Socket.IO upgrades to `API_INTERNAL_URL`; Next HMR upgrades stay with Next. All user session cookies therefore remain first-party. Browsers never need an internal API hostname.
2. Express validates payloads with Zod, authenticates the session using the hash of the HTTP-only cookie, enforces double-submit CSRF on authenticated mutations, and authorizes the target in service code. An `Origin` allowlist and request rate limits apply before private routes.
3. `sendMessage` authorizes the target, checks the nonce, applies rate limits, commits message and attachment claims in PostgreSQL, *then* emits `message:created`. A reused nonce with the same content/target/reply/attachments returns the persisted message without re-broadcasting; a mismatched payload returns `409`.
4. Socket connections use the same cookie; `socket.use` revalidates the session before **each** client packet. Channel/conversation subscriptions and sends recheck current membership and role overrides. Membership/role changes force relevant socket disconnections. A missed event is recovered by authorized REST history after reconnection.
5. Full-text search computes **authorized channel IDs first**, then uses a parameterized PostgreSQL query with a GIN index. DM content is not included in channel search. History uses a stable `(createdAt,id)` cursor rather than offset for message pagination.
6. Uploads are held in memory only up to the configured per-file limit, MIME-detected, stored privately, and attached to a message in a transaction. Reads require an active authorized channel/conversation, the uploader of an **unclaimed** file, or a referenced avatar/community icon; S3/Cloudinary reads use short-lived signed URLs. The orphan-upload job rechecks unclaimed attachments under a PostgreSQL row lock, coordinating with avatar/icon assignments before blob deletion.

### Identity and permissions

- The `Session` table stores only token/CSRF **hashes**, with expiry, last activity and revocation. Registration, login, logout and password reset rotate/revoke as appropriate. `UserBlock` forbids both sides of a DM/group from subscribing or messaging.
- Every new community gets managed Owner/Administrator/Moderator/Member roles and a starter category/channels. Roles have positions and permissions. Owners override channel policy; non-owners must satisfy role hierarchy. Private channels require an explicit view grant (or channel-management permission). Channel deny/allow overrides and personal overrides are evaluated on the API—not trusted to the UI.
- Invitations contain 256-bit random tokens; only hashes persist. Conditional transactional usage updates prevent two concurrent accepts from exceeding `maxUses`. A ban prevents joining. Ownership transfer updates managed-role membership and disconnects old sockets.

### Optional infrastructure / failure behavior

- **Redis absent:** one API instance only; process-local presence and message throttling, no cross-process socket adapter, BullMQ cleanup not scheduled. Run `npm run cleanup:orphans` with a scheduler. Multiple API instances without Redis are **not supported**.
- **Redis configured:** publish/subscribe Socket.IO adapter, Redis-backed rate limits/presence and hourly orphan-upload cleanup worker. Redis failures must be monitored and are reflected in `/api/ready`.
- **LiveKit absent:** call-token routes return `503`, and the UI shows an unavailable state. Media is never simulated through Socket.IO. When configured, the API performs access checks before minting a one-hour, room-scoped JWT; LiveKit carries voice/video/screen tracks.
- **SMTP absent:** development can auto-verify registration; production startup fails. Password-reset requests report unavailable instead of pretending mail was sent.
- **Storage:** local disk is a development option only; production startup requires Cloudinary or S3-compatible storage. Deleting a channel/community cascades DB rows; object-store blobs need an object lifecycle/reconciliation policy beyond the orphan-upload job (see [SECURITY.md](SECURITY.md)).

### Repository modules

`apps/api/src/routes/` contains thin HTTP handlers; `services/` owns authorization-sensitive workflows; `middleware/auth.ts` holds cookie/CSRF logic; `socket/index.ts` registers authenticated packet handlers; `workers/cleanup.ts` runs retention cleanup. `packages/db/prisma/migrations/` holds the immutable PostgreSQL migration SQL, including constraints not expressible by Prisma schema. `apps/web/components/app/` contains the chat/sidebar/dialog/call experiences; `apps/web/lib/api.ts` is the first-party HTTP client.
