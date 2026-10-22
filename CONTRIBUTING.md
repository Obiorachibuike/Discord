# Contributing to Cove

Cove is **not** an official Discord project. Keep branding, copy, graphics and any added assets original or properly licensed. Favor secure, complete vertical slices over nonfunctional mock controls or optimistic claims about external integrations.

## Set up

Use Node.js 22.12+, npm and PostgreSQL 16+. From the repository root:

```bash
npm ci
cp .env.example .env
# Put a random local SESSION_SECRET (>=32 characters) in .env.
# For Docker: add a unique POSTGRES_PASSWORD to .env, then change DATABASE_URL
# (and TEST_DATABASE_URL if testing) to use that password.
docker compose up -d postgres    # or: npm run dev:postgres in a separate terminal
npm run db:deploy                 # restricted local engine? npm run db:local-deploy
npm run dev
```

Never commit `.env`, credentials, runtime uploads, browser traces/screenshots, `.next/`, or local database files. See `.gitignore`. Redis can be started with `docker compose up -d redis` when testing distributed features.

## Workflow and checks

- Locate the relevant route, service, shared contract, Prisma model/migration and UI component *before* editing. Do not weaken server-side authorization to fix a frontend issue. Keep public responses sanitized; no auth tokens in browser storage.
- Add Zod validation, tests for authorized and denied behavior, and an explicit error code for new API/socket operations. Persist state in Postgres before acknowledging a write; use client nonces for retriable messages. Recheck private/blocked/membership paths in REST **and** sockets.
- For schema changes, create and review a **new committed migration**; preserve the SQL-only CHECK constraints and indexes in the initial migration. Test migration on a disposable `_test` database. Do not edit a migration already applied anywhere.
- Update [API.md](API.md), [SOCKET_EVENTS.md](SOCKET_EVENTS.md), [DATABASE.md](DATABASE.md), `.env.example` and security/deployment docs when protocols or environment requirements change.

```bash
npm run typecheck
npm run lint
npm run test
npm run test:integration     # resets ONLY *_test DB
npm run test:e2e             # resets ONLY *_test DB, runs Chromium + test servers
npm run build
npm audit
```

Tests assume a local Postgres on `127.0.0.1:5432`; `TEST_DATABASE_URL` can point to a **disposable database whose name ends in `_test`**. Never point test preparation at live data. Avoid running integration and E2E concurrently against the same test DB. Browser tests run on ports 3100/4100 with a separate Next build directory, so the developer preview on 3000/4000 can remain up.

## Review checklist

1. Verify anonymous, normal-member, privileged and blocked/private behavior, including search, attachment access, socket subscriptions and reconnection; check horizontal behavior if Redis is affected.
2. Confirm validation, CSRF/Origin defenses, rate limits, idempotency, pagination, error sanitization and log redaction still apply. Add a migration for schema/invariant changes.
3. Use native semantic elements/labels, visible keyboard focus, reduced-motion support and a usable narrow-viewport layout. Touch devices cannot depend solely on hover actions.
4. If touching Cloudinary/S3, SMTP, Google or LiveKit: run staging tests with **real configured credentials** and document any untested paths; do not invent success responses. Keep integrations explicitly unavailable when unconfigured.
5. Note npm audit findings and production/runtime dependency implications in the review. Disclose known failures rather than calling a partial test run green.

Please report security-sensitive findings privately to the repository maintainers; do not publish private user data, session cookies, invitation links or provider secrets in issue threads.
