# Cove — engineering report

**Verification date:** 22 October 2026. **Product:** original-branded, Discord-inspired communication platform; not affiliated with Discord. **Assessment:** a working PostgreSQL-backed local vertical slice with significant backend access controls and a usable desktop/mobile UI, **not a credential-verified or security-cleared production release**.

## Delivered architecture and scope

| Area | Implemented | Verification boundary |
| --- | --- | --- |
| Application | npm/TypeScript monorepo; Next.js 16 App Router/React/Tailwind/Radix UI; Express REST and authenticated Socket.IO behind a same-origin Next reverse proxy | Browser registration, community/channel navigation, search, messages, invitations, live delivery, mobile navigation, friends and DMs tested |
| Data | PostgreSQL 16 / Prisma 6 with committed migration, SQL constraints and indexes; DB-backed users, sessions, memberships, roles, messages, attachments, moderation, notifications | Initial migration, DB query, unit/integration/browser flows tested; official Prisma production migration engine **not** available in this network-restricted environment |
| Identity/security | Argon2id, hashed opaque HTTP-only sessions, CSRF, Origin/CORS/WebSocket handshake checks, request/packet validation, private-channel and DM authorization, blocks, rate limits | API/socket tests include denied requests, private search/upload access, origin rejection, revocation and role hierarchy; **no independent penetration test** |
| Community/social | Roles, categories/channels, expiring/limited invites, ownership transfer, moderation/report and audit paths; friends, blocks, DMs/groups, presence, notifications | Representative REST and browser flows tested; not every settings/control combination has a browser test |
| Messaging/media | Persist-before-ack sends, nonce deduplication, cursor history, PostgreSQL channel search, replies, edits, reactions, pins, private attachments and download checks | Representative API/socket/browser flows tested; cleanup of stale uploads tested with claimed files, avatars and community icons preserved |
| Optional integrations | Google OAuth, SMTP verification/recovery, Cloudinary/S3, LiveKit voice/video/screen share, Redis socket/presence/rate coordination and BullMQ cleanup | **Not verified end to end**: external credentials/servers were unavailable. Routes use real provider APIs and report unavailable when unconfigured; no mock success is advertised. The no-Redis one-shot cleanup was tested locally. |

The server stores durable data in PostgreSQL, not process arrays or a demo fixture. Redis is optional only for **one** API process; multi-process real-time delivery/rate limits require Redis. Local disk and automatic email verification are development-only. Production API startup requires trusted-proxy configuration, SMTP, a strong session secret and durable Cloudinary/S3 storage. The API port must be private behind an HTTPS web origin. See [ARCHITECTURE.md](ARCHITECTURE.md), [DATABASE.md](DATABASE.md), [SECURITY.md](SECURITY.md) and [DEPLOYMENT.md](DEPLOYMENT.md).

## Reproducible verification

| Command/check | Result in this workspace |
| --- | --- |
| `npm ci`, `npm run db:validate` | Passed; Prisma Client generated and schema accepted. |
| `npm run db:local-deploy` on local PostgreSQL 16.14 | Passed; committed `20261020204500_initial` migration applied. The offline SQL runner checks migration checksums. |
| `npm run typecheck`, `npm run lint`, `npm run build` | Passed: shared/DB/API TS and optimized Next production build; ESLint emitted no errors. |
| `npm run test` | **9/9** unit tests passed: contracts, permission/validation helpers, hashing and anti-replay behavior. |
| `npm run test:integration` | **9/9** API/socket integration tests passed against an isolated `cove_test` PostgreSQL database. Coverage includes session/CSRF, permissions, search, invites, idempotency, mentions, friends/DMs/blocks, moderation, private files, orphan cleanup and WebSocket Origin/session isolation. |
| `npm run test:e2e` | **3/3** Chromium Playwright scenarios passed: persisted messaging/search; second-account invitation + live delivery + mobile navigation; friend request + direct chat. Runs on isolated ports 3100/4100 and resets only `cove_test`. |
| Production-web preview smoke | Next `/login` and proxied `/api/ready` returned HTTP 200; `/login` included CSP, HSTS and other security headers without `X-Powered-By`. A headless Chromium visit hydrated the login form (password visibility toggle worked) without console/page errors. This uses a development-mode API behind the production-built web server, **not** a credentialed production deployment. |

**Test limits:** Most endpoint permutations, provider-backed behavior, Redis/multi-instance coordination, real TLS/edge proxy behavior, cross-browser call controls, email deliverability and production migration execution were **not** exercised. Tests reset only a database whose name ends in `_test`; never run them against a production database. An upstream `pg` concurrent-query deprecation warning appears in integration output from the Prisma PostgreSQL adapter; tests still pass, but this should be tracked before a future pg major upgrade.

## Security and release risks

1. **External configuration unverified.** No Google, SMTP, LiveKit, Cloudinary or S3 credentials were supplied. Provision staging providers and check real OAuth callback/state, email verification/reset delivery, private object access/retention, signed LiveKit webhooks, multi-browser media and screen-share permissions. Unconfigured calls/email return unavailable rather than pretending to work.
2. **Dependency advisories.** The final `npm audit` reports **11 vulnerabilities: 9 high, 2 moderate, 0 critical** (Prisma 6 CLI/config and Tailwind 3 build-tool dependencies). `npm audit --omit=dev` still reports **4 high** through Prisma's dependency tree; a production image is *not* audit-clean. Upgrading to Prisma 7/Tailwind 4 requires coordinated, tested migrations. Keep build tools out of the runtime image, review the advisory exploit surface, and resolve or explicitly accept the risk before a sensitive launch.
3. **Data lifecycle.** File signature/MIME checks are not malware scanning. No full account deletion/export, end-to-end encryption, push notification service, hard-delete object-store reconciliation or formal penetration/load test is provided. Old unclaimed uploads are cleaned with row locks, but object storage deletion and SQL cannot be perfectly atomic; back up/reconcile both. See [SECURITY.md](SECURITY.md).
4. **Operations.** Establish real TLS termination, restricted API ingress, trust-proxy/edge header validation, Redis for >1 API worker, DB/object-store backups and restore drills, monitoring/alerting, storage lifecycle, queue observability, and staging failure drills. The production CSP currently permits framework-required inline scripts/styles; consider nonce/hashes. Native Prisma engine downloads failed in this sandbox, so `db:local-deploy` was used for local testing; use `prisma migrate deploy` and a reviewed deployment pipeline in normal production infrastructure.

**Go-live recommendation:** Treat Cove as a functional, test-backed foundation, not as an already certified production service. Run the provider and infrastructure checks above on staging, remediate/review advisories, test backup restore and real edge WebSockets, and only then make production availability or security assurances.
