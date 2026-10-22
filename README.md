# Aether

**Aether** is a modern, self-hostable communication platform for communities — real-time text
channels, voice/video rooms, screen sharing, direct messages, roles, permissions and moderation,
in one full-stack TypeScript monorepo.

> Aether is an original product with its own identity and branding. It is not affiliated with,
> endorsed by, or a copy of Discord's proprietary assets.

## Features

- **Servers & channels** — categories, text/voice/announcement channels, private channels with
  per-role and per-member overrides, invites with expiry/use limits.
- **Real-time messaging** — Socket.IO delivery with optimistic `clientId` dedup, replies,
  reactions, pins, edits, deletes, typing indicators, read states and pagination (never loads
  full history into the browser).
- **Voice & video** — LiveKit-powered voice channels, camera tiles and screen sharing with a
  one-click join panel (explicit "not configured" state until LiveKit credentials are set).
- **Friends & DMs** — friend requests, presence, direct and group conversations, blocks.
- **Roles & permissions** — 19 permission bits, deny-by-default authorization, owner bypass,
  server defaults + channel overrides resolved server-side on every operation.
- **Moderation** — kick, ban, timeout, reports and an audit log trail.
- **Accounts** — email verification, password reset, Argon2id hashing, HTTP-only session
  cookies with CSRF double-submit, optional Google ID-token sign-in.
- **Search** — PostgreSQL full-text search scoped per server with permission filtering.
- **Attachments** — drag-and-drop upload with local disk, Cloudinary or S3/R2 storage drivers.

## Monorepo layout

| Package | What it is |
| --- | --- |
| `packages/shared` | Zod schemas, DTO types, permission bits, socket contract — shared by everything |
| `packages/database` | Prisma schema, migrations, seed, client |
| `packages/server` | Express REST API + Socket.IO gateway (Vitest: 104 tests) |
| `packages/web` | Next.js 15 App Router frontend (React 19, Tailwind, TanStack Query) |
| `scripts/` | Embedded-Postgres helper, boot smoke, one-command run |

## Quick start

Requirements: Node.js ≥ 20, npm ≥ 10. A local PostgreSQL is **not** required for development —
the repo ships an embedded PostgreSQL runner.

```bash
npm install
npm run generate --workspace @aether/database   # generate Prisma client
npm run build --workspace @aether/shared && \
npm run build --workspace @aether/database && \
npm run build --workspace @aether/server && \
npm run build --workspace @aether/web

node scripts/run-app.mjs
# → http://localhost:3000  (API proxied at /api and /socket.io)
```

`run-app.mjs` starts an embedded PostgreSQL, runs migrations, seeds demo data on first run, and
boots the API (:4000) behind the single-origin web server (:3000).

**Demo accounts** (password for all: `Passw0rd!demo`):

| Username | Email |
| --- | --- |
| `ada` | ada@aether.dev |
| `grace` | grace@aether.dev |
| `alan` | alan@aether.dev |
| `katherine` | katherine@aether.dev |

### With your own PostgreSQL

```bash
cp .env.example .env          # set DATABASE_URL (required) and friends
npm run migrate               # apply SQL migrations
npm run seed                  # optional demo data
npm run dev                   # API + web in watch mode (separate processes)
```

## Tests

```bash
npm test                      # 104 Vitest tests: unit + integration + realtime
npm run typecheck             # strict TS across all packages
npm run lint
npm run e2e                   # Playwright end-to-end (see below)
```

Test coverage includes permission resolution, crypto/session primitives, every REST resource
(auth, servers, channels, messages, social, moderation) and the Socket.IO contract
(auth, rooms, delivery, dedup, typing, reconnect, isolation).

E2E specs live in `e2e/`. Playwright browsers download from a CDN on first `npx playwright
install`; in restricted networks this may fail — the specs still document the flows.

## Configuration

Everything is environment-driven — see [`.env.example`](.env.example) for the full annotated
list and [`docs/DEPLOYMENT.md`](docs/DEPLOYMENT.md) for production guidance. Highlights:

- **Storage**: `local` (dev/self-host), `cloudinary`, or `s3`/R2.
- **Email**: `smtp` (production), `console` (dev — logs the emails), `none`.
- **Voice**: set the three `LIVEKIT_*` values to enable voice/video; without them the app is
  fully usable except voice, and says so explicitly.
- **Redis**: optional; presence falls back to process-local.

## Documentation

| Document | Contents |
| --- | --- |
| [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) | System design, data flow, realtime pipeline |
| [`docs/API.md`](docs/API.md) | REST endpoint reference |
| [`docs/SOCKET_EVENTS.md`](docs/SOCKET_EVENTS.md) | Socket.IO contract |
| [`docs/DATABASE.md`](docs/DATABASE.md) | Schema & migration guide |
| [`docs/SECURITY.md`](docs/SECURITY.md) | Auth model, threat notes |
| [`docs/DEPLOYMENT.md`](docs/DEPLOYMENT.md) | Docker/Node/Vercel deployment |
| [`docs/CONTRIBUTING.md`](docs/CONTRIBUTING.md) | Dev workflow & conventions |

## License

MIT — see [LICENSE](LICENSE).
