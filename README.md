# Cove

**A place for your people.** Cove is an original-branded, Discord-inspired communication platform—not affiliated with Discord. This repository contains a working, database-backed web application rather than a static mockup.

## What is implemented

- Account registration/sign-in, Argon2id passwords, email verification and recovery when SMTP is configured, optional Google OAuth, HTTP-only server-side sessions, CSRF, device sessions, profiles, themes, and presence.
- Communities, expiring/use-limited invitation links, categories, text/announcement/voice channels, private-channel overrides, role hierarchy and assignment, ownership transfer, moderation, reports, audit log, and deletion.
- Persisted channel and private/group messages, Socket.IO delivery, typing, replies, editing, reactions, pins, uploads, pagination, idempotent sends, and authorized PostgreSQL full-text search.
- Friend requests, blocks, private/group conversations, in-app notifications, and an adaptive desktop/mobile React interface.
- Optional LiveKit call-token/room integration for voice, video, screen sharing, and device controls; optional Redis for distributed Socket.IO, presence, rate limits, and BullMQ attachment cleanup.

**Honest boundary:** without external credentials, Google sign-in, SMTP delivery, Cloudinary/S3 storage, and LiveKit calls cannot be exercised end to end. The UI hides unconfigured Google sign-in, the API returns an explicit `503` for unavailable call/email operations, and production refuses to start without SMTP and durable object storage. See [ENGINEERING_REPORT.md](ENGINEERING_REPORT.md) for verified results and limitations.

## Quick start

Requirements: Node.js **22.12+**, npm, PostgreSQL **16+** (or Docker). Redis is optional for a single API instance.

```bash
npm ci
cp .env.example .env
# Set SESSION_SECRET in .env to a random value of at least 32 characters.
# Start Postgres using ONE option:
# For Docker, add a unique POSTGRES_PASSWORD to .env and update DATABASE_URL
# to use that SAME password (and TEST_DATABASE_URL if you will run tests).
docker compose up -d postgres
# OR: npm run dev:postgres  (foreground, bundled development-only Postgres;
# its password matches the development-only DATABASE_URL in .env.example)
npm run db:deploy
npm run dev
```

Open **http://localhost:3000**. The API listens on port 4000. `apps/web/server.mjs` serves Next.js and proxies `/api/*` and `/socket.io/*` over the **same browser origin**; do not point browser JavaScript to `localhost:4000` in a remote preview. `npm run dev:postgres` is a foreground process—use a separate terminal. Run `docker compose up -d redis` and set `REDIS_URL` only if you need Redis features.

If the official Prisma schema-engine binary cannot be downloaded in a network-restricted development environment, apply the **committed SQL** with `npm run db:local-deploy` instead of `npm run db:deploy`. This fallback checks migration checksums and was exercised against local PostgreSQL; use the official `prisma migrate deploy` on normal production hosts. Never reset a non-test database for testing.

Local development with no SMTP auto-verifies new registrations. **This shortcut is disabled in production.** Without SMTP, password recovery cannot send mail. Development files use `.local-uploads/`; it is not a production storage option.

### Useful commands

| Command | Purpose |
| --- | --- |
| `npm run dev` | Start API and same-origin web development servers |
| `npm run build` | Compile shared contracts, DB, API, and Next production build |
| `npm run typecheck` / `npm run lint` | Validate TS and lint source/tests |
| `npm run test` | Isolated unit tests |
| `npm run test:integration` | **Resets only a database named `*_test`**, applies migrations, runs API/socket tests |
| `npm run test:e2e` | **Resets only `*_test`**, runs API and web on **4100/3100**, executes Chromium browser flows |
| `npm run db:validate` / `npm run db:deploy` | Validate schema / apply committed production migrations |
| `npm run cleanup:orphans` | One-shot removal of uploads unused for >24 hours without Redis |

E2E uses the `@sparticuz/chromium` executable bundled as a dev dependency and extracts missing NSS libraries to `/tmp` on minimal Linux hosts. It does **not** use your `cove` development data; choose a disposable `TEST_DATABASE_URL` whose database name ends in `_test`. Do not run it with a production database or while another test runner is using the same `_test` database.

## Repository guide

- [`ARCHITECTURE.md`](ARCHITECTURE.md): services, trust boundaries, data flow and scaling.
- [`API.md`](API.md): REST endpoints, authentication, examples, pagination and errors.
- [`SOCKET_EVENTS.md`](SOCKET_EVENTS.md): Socket.IO events, acknowledgements and authorization.
- [`DATABASE.md`](DATABASE.md): schema, invariants, migration and backup strategy.
- [`SECURITY.md`](SECURITY.md): threat model, privacy controls and security caveats.
- [`DEPLOYMENT.md`](DEPLOYMENT.md): production requirements, configuration and operations.
- [`CONTRIBUTING.md`](CONTRIBUTING.md): workflow, tests and contribution expectations.
- [`ENGINEERING_REPORT.md`](ENGINEERING_REPORT.md): verified results, limitations and next work.

Source lives in `apps/web` (Next App Router, React, Tailwind/Radix), `apps/api` (Express + Socket.IO), `packages/db` (Prisma/Postgres), and `packages/shared` (Zod contracts). `.env.example` lists all configuration; secrets belong in `.env` or a deployment secret manager, never source control.

Cove is a standalone learning/production-oriented implementation. Deployments still require operational work: TLS, a production Postgres and object store, monitoring/backups, capacity tests, incident response, and third-party credentials. Consult the engineering report before making production claims.
