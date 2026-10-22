# Deployment and operations

Cove runs as **two Node.js processes** plus PostgreSQL: an Express/Socket.IO API and a Next.js web server with a same-origin reverse proxy. Docker Compose in this repository is a **development** Postgres/Redis convenience, not a production cluster or secret manager. It requires a generated `POSTGRES_PASSWORD` in your ignored `.env` and a matching `DATABASE_URL`; container ports bind to localhost only.

## Production prerequisites

- Node.js **22.12+**, PostgreSQL **16+**, TLS termination, a durable S3-compatible bucket or Cloudinary account, SMTP, a strong secret, and a backup/restore plan. Redis is required for **more than one API replica** and recommended for scheduled orphan cleanup even on one replica.
- Keep the API on a **private network** accessible only from the web/proxy tier. Expose only the HTTPS web origin. Do not make an untrusted client a directly trusted proxy.
- Verify `npm audit` results and [SECURITY.md](SECURITY.md) before a sensitive release; some Prisma 6 CLI/Tailwind 3 toolchain advisories remain. Build in a controlled CI environment and deploy the smallest runtime artifact, not an open dev toolchain.

## Environment

Copy `.env.example` for local configuration; inject secrets from a secret manager in production. Never commit `.env`. Required variables in production:

| Variable | Meaning |
| --- | --- |
| `NODE_ENV=production` | Enables Secure cookies and production startup guards. |
| `DATABASE_URL` | Private PostgreSQL URL; database role with only necessary runtime grants, TLS as appropriate. |
| `WEB_ORIGIN` | Exact public HTTPS origin, e.g. `https://cove.example.net`; used for CORS, invite links and email links. |
| `SESSION_SECRET` | At least 32 unpredictable characters, not the example placeholder. Rotate with session-revocation plan. |
| `TRUST_PROXY` | **Required >0** by production guard; number of **trusted proxy hops** before API. `1` for web→API, `2` when a trusted TLS proxy precedes web. Configure the edge proxy to append verified client IP, and block direct API access; otherwise rate limits can be bypassed/spoofed or shared across users. |
| `API_PORT`, `WEB_PORT`, `API_INTERNAL_URL` | API listen port (4000), web listen port (3000), internal URL from web to API (e.g. `http://api.internal:4000`). Browser code uses only relative paths. |
| `SMTP_HOST`, `SMTP_PORT`, `EMAIL_FROM` | Working mail delivery **required** by production startup; set `SMTP_USER`, `SMTP_PASSWORD` if needed. Verify real verification/reset emails on staging. |
| `STORAGE_PROVIDER=cloudinary` or `s3` | Local disk is forbidden at production startup. Cloudinary needs cloud name/API key/secret; S3-compatible needs endpoint/region/bucket/access-key ID/secret key. Keep buckets private. |
| `MAX_UPLOAD_MB` | Per-file upload limit (default 10 MB, hard maximum 100 MB); set a matching edge proxy body limit. |

Optional variables: `REDIS_URL` for distributed Socket.IO/presence/rate limits and BullMQ; `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_REDIRECT_URI=https://<web-host>/api/auth/google/callback` for real Google OAuth; `LIVEKIT_URL=wss://...`, `LIVEKIT_API_KEY`, `LIVEKIT_API_SECRET` for calls. Do not set incomplete groups: Cloudinary/S3 config is validated at startup; unconfigured OAuth/calls expose an unavailable state, not a mock. Register the exact Google callback URI and LiveKit webhook at `https://<web-host>/api/calls/webhook` with those providers. No separate `LIVEKIT_WEBHOOK_KEY` is consumed; webhook validation uses the configured LiveKit key/secret.

## Build, migrate, start

Run from the repository root in a normal CI/host with access to npm and Prisma's official migration engine:

```bash
npm ci
npm run db:validate
npm run db:deploy     # before serving writes; run once in an orchestrated rollout
npm run typecheck
npm run lint
npm run test
npm run build         # shared types, DB, API and optimized Next build
```

Start separate long-running processes with your supervisor/container orchestration:

```bash
npm run start -w @cove/api
npm run start -w @cove/web
```

Both listen on `0.0.0.0` (private/firewalled API); place TLS in front of the web process and forward `Host`, `X-Forwarded-For` (verified/append-only), and WebSocket `Upgrade`/`Connection` headers. The web server forwards `/api/` and `/socket.io/` to `API_INTERNAL_URL`, with `xfwd` enabled; other paths reach Next. Do not rewrite Socket.IO polling only—**upgrade** must work. Static-hosting-only deployments or a REST-only Next rewrite will break realtime calls to the API. Next `start` uses the custom `server.mjs`; do not substitute `next start` unless an equivalent same-origin WebSocket proxy is provided.

`GET /api/health` checks process liveness; `GET /api/ready` checks DB and configured Redis. Keep the API out of the public ingress, enable alerts for 5xx/readiness failures, queue failures, DB pool exhaustion, Redis disconnects, slow queries and object-store errors. Log request IDs and use a restricted retention policy for logs.

### Single instance vs horizontal scaling

Without `REDIS_URL`, run **one** API process. Messages/permissions still persist in Postgres, but presence, rate limits, realtime rooms and notification delivery cannot coordinate across API processes. With Redis, Socket.IO uses a Redis adapter, rate limits and presence are coordinated, and BullMQ schedules hourly orphan-upload cleanup. Run `npm run cleanup:orphans` from a controlled scheduler without Redis. This job removes unused, **unclaimed** attachments older than 24 hours; it does not garbage-collect blobs from a deleted community. Configure object-store lifecycle/reconciliation separately.

### Releases, backup and rollback

Back up the Postgres DB and private object storage; regularly **test** restore to staging. Apply additive migrations, deploy compatible API/web, backfill if needed, then remove old columns in a later release. Do not edit a committed/applied migration. `npm run db:local-deploy` is a checksum-guarded offline *development fallback* for the committed SQL—not a production replacement for `prisma migrate deploy`. If a rollout fails, roll back binaries first; handle schema rollback by a reviewed forward migration, not an unsafe database rewind while writes continue.

Before go-live, test registration/verification/password reset, Google OAuth if enabled, multipart upload/download/private access using the chosen object store, LiveKit calls/webhooks/media permissions across browsers, WebSocket connection/reconnection through real TLS, backup restore, and multi-instance behavior if Redis is enabled. These external flows were **not** exercised in the repository's local automated tests. Consult [ENGINEERING_REPORT.md](ENGINEERING_REPORT.md) for precisely what was verified.
