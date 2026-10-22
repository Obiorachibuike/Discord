# Architecture

Aether is a TypeScript monorepo with four packages and a strict dependency direction:

```
shared  ←  database  ←  server
   ↑                      ↑
   └──────── web ─────────┘        (web also proxies /api + /socket.io → server)
```

## Request & realtime topology

```
Browser (Next.js App Router, React 19)
   │  fetch  /api/*        (relative URLs, same origin)
   │  ws     /socket.io
   ▼
packages/web/server.mjs          ← single origin :3000
   │  http-proxy  (incl. HTTP Upgrade for WebSockets)
   ▼
packages/server (Express + socket.io)   :4000
   │
   ├─ PostgreSQL (users, servers, channels, messages, moderation, …)
   ├─ Redis (optional — presence pub/sub; process-local fallback)
   ├─ Storage driver (local disk | Cloudinary | S3/R2)
   ├─ SMTP / console email
   ├─ BullMQ-compatible job hooks (email + maintenance)
   └─ LiveKit (voice/video/screen-share token minting)
```

The single-origin proxy exists so session cookies are always first-party and the browser never
calls cross-origin APIs. For split-origin deployments (e.g. Vercel frontend + separate API
host), run `next start` directly and set `NEXT_PUBLIC_API_URL`; the API's CORS allowlist and
cookie settings then apply (see DEPLOYMENT.md).

## Backend layering (`packages/server`)

1. **Routes** (`src/routes/*`) — thin HTTP adapters: parse (Zod), authorize, call a service,
   serialize DTOs. No business logic.
2. **Services** (`src/services/*`) — one domain each (auth, server, channel, message,
   conversation, friend, moderation, permission, search, notification, upload, storage, voice,
   email, presence, session, password, rate-limit).
3. **Middleware** — `requireAuth`/`optionalAuth` (DB-backed opaque session tokens),
   `validateBody`/`validateQuery` (Zod), security headers, CSRF double-submit, rate limiting,
   central error handler.
4. **Socket gateway** (`src/socket/*`) — mirrors REST authorization for every event.

### Authorization model (deny-by-default)

Every channel/server operation resolves a permission bitmask before acting:

1. Owner bypass → all bits.
2. Base role permissions (default @everyone) **plus** all assigned role permissions.
3. Channel overrides applied per role, then per member.
4. Explicit **deny always beats allow**.
5. Private channels require an explicit channel-level `VIEW_CHANNELS` allow.

The same resolvers power REST handlers and socket event handlers — there is no separate,
weaker realtime path.

## Realtime pipeline

- Socket.IO rooms: `user:<id>`, `server:<id>`, `channel:<id>`, `conversation:<id>`.
- On connect the server registers **all** event handlers synchronously, then performs async
  room joins and emits `ready` (this ordering matters — registering after awaits drops
  immediately-emitted client events).
- Messages are persisted to PostgreSQL **before** the ack and before room broadcast;
  each message carries an optional `clientId` so sender-side optimistic entries dedup.
- Typing indicators are ephemeral (never persisted) and fan out to the room only.
- Presence is fan-out to friends and server peers; with Redis it is shared across nodes,
  without Redis it is process-local (documented single-node limitation).

## Frontend (`packages/web`)

- **Next.js 15 App Router** with client components for the interactive app shell.
- **TanStack Query** owns server state; `useRealtime()` maps socket events onto query caches
  (append/edit/remove messages, invalidate friends/conversations/notifications).
- **Message history** uses `useInfiniteQuery` windows of 50 (`direction=before` cursor
  pagination) — the browser never loads an entire channel.
- **shadcn-style UI** (hand-rolled on Radix primitives), Tailwind design tokens with
  HSL CSS variables, dark/light themes + accent presets (localStorage preferences only).
- **socket.io-client** singleton (`src/lib/socket.ts`), **livekit-client** for voice.
- API client (`src/lib/api.ts`) is `fetch`-based: JSON, `credentials: include`, automatic
  CSRF header from the `aether_csrf` double-submit cookie, typed `ApiError`.

## Data flow: sending a message

1. Composer → `POST /api/messages` (or `conversation` variant) with `clientId`.
2. Service: permission check → insert row (transaction) → DTO.
3. Response ack returns the persisted message; sender cache dedups by `id`/`clientId`.
4. Gateway broadcasts `message:created` to the channel/conversation room (includes the
   author's other devices via `user:<id>` room).
5. Recipients' `useRealtime` appends to their message cache; notification rows are created
   for mentions/DMs and delivered as `notification:new`.

## Testing strategy

- **Unit** (27): permission resolution, Zod contracts, crypto/password/session helpers.
- **Integration** (67): a full Express app against real PostgreSQL — auth lifecycle, servers,
  channels, pagination, messages/reactions/pins, friends/DMs/blocks, moderation.
- **Realtime** (10): two real socket clients against the gateway — ready handshake, payload
  validation, presence, DM delivery, room isolation, unauthorized subscribe rejection,
  clientId dedup, typing, reconnect.
- **E2E**: Playwright specs over the real stack (browser download may be blocked in
  restricted networks — see README).

`node scripts/boot-smoke.mjs` is the end-to-end boot check: embedded PostgreSQL → migrations →
seed → API → web proxy → login/session/CSRF assertions.
