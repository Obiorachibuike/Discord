# Deployment

## Topologies

**A. Single node (recommended default)** — one Node process runs the web server (Next + proxy)
and one runs the API, behind a TLS-terminating reverse proxy (Caddy/nginx). PostgreSQL local
or managed.

**B. Split-origin** — frontend on Vercel/Netlify, API + Socket.IO on a Node host. Requires
HTTPS everywhere, `NEXT_PUBLIC_API_URL`, matching `CORS_ORIGINS`, `COOKIE_SECURE=true` and
`SameSite=None` considerations (session cookie is issued first-party only in topology A).

## Node.js (systemd / container)

```bash
npm ci
npm run generate --workspace @aether/database
npm run build --workspace @aether/shared
npm run build --workspace @aether/database
npm run build --workspace @aether/server
npm run build --workspace @aether/web

# API
DATABASE_URL=postgres://… SESSION_SECRET=$(openssl rand -base64 48) \
NODE_ENV=production PORT=4000 node packages/server/dist/index.js

# Web (single origin, proxies /api + /socket.io → API)
NODE_ENV=production PORT=3000 API_ORIGIN=http://127.0.0.1:4000 \
node packages/web/server.mjs
```

Apply migrations on release: `npm run migrate`. Run multiple API replicas only with
`REDIS_URL` set (shared presence/rate data).

## Environment checklist (production)

| Variable | Note |
| --- | --- |
| `DATABASE_URL` | required; use a pooled connection string (PgBouncer) |
| `SESSION_SECRET` | ≥32 random chars |
| `COOKIE_SECURE=true` | HTTPS only |
| `TRUST_PROXY=true` | behind nginx/Caddy |
| `CORS_ORIGINS`, `WEB_URL` | exact public origin |
| `EMAIL_PROVIDER=smtp` + `SMTP_URL` | real deliverability |
| `STORAGE_DRIVER=s3\|cloudinary` + creds | durable attachments |
| `LIVEKIT_URL/API_KEY/API_SECRET` | voice/video; otherwise the UI states "not configured" |
| `REDIS_URL` | multi-node presence |

## Docker

Example API image:

```dockerfile
FROM node:22-slim AS build
WORKDIR /app
COPY package*.json ./
COPY packages/shared/package.json packages/shared/
COPY packages/database/package.json packages/database/
COPY packages/server/package.json packages/server/
RUN npm ci
COPY . .
RUN npm run generate --workspace @aether/database \
 && npm run build --workspace @aether/shared \
 && npm run build --workspace @aether/database \
 && npm run build --workspace @aether/server

FROM node:22-slim
WORKDIR /app
ENV NODE_ENV=production
COPY --from=build /app ./
EXPOSE 4000
CMD ["node", "packages/server/dist/index.js"]
```

Build the web image the same way (with `packages/web`) and run with
`API_ORIGIN=http://api:4000`. Compose both with `postgres:16` and (optionally) `redis:7`
and `livekit/livekit-server`. Keep `uploads/` on a volume when `STORAGE_DRIVER=local`.

## Vercel (split-origin frontend)

1. Root directory `packages/web`, framework Next.js.
2. Set `NEXT_PUBLIC_API_URL=https://api.example.com` (build + runtime).
3. The API must allow the Vercel origin in `CORS_ORIGINS` and run with `COOKIE_SECURE=true`.
4. Socket.IO needs a sticky, WebSocket-capable host (Railway/Render/Fly/EC2); serverless
   functions cannot host the gateway.

## Reverse proxy (nginx sketch)

```nginx
location / {
  proxy_pass http://127.0.0.1:3000;
  proxy_http_version 1.1;
  proxy_set_header Upgrade $http_upgrade;
  proxy_set_header Connection "upgrade";
  proxy_set_header Host $host;
  proxy_set_header X-Forwarded-Proto $scheme;
  proxy_read_timeout 3600s;
}
```

The web server already proxies `/api/*` and `/socket.io/*` (including WS upgrades) to the
API — no second upstream block needed in topology A.

## Health & operations

- `GET /api/health` — liveness; `GET /api/ready` — DB readiness (wire to LB checks).
- Logs: structured pino JSON on stdout (`LOG_LEVEL`).
- Backups: pg_dump on a schedule; `uploads/` volume or provider-side versioning.
- Upgrades: run migrations, then roll the API, then the web process.

## Voice (LiveKit)

Deploy LiveKit (self-host or cloud), set `LIVEKIT_*`, and point clients at the LiveKit WS
URL returned by the token endpoint. Until configured, `/api/voice/status` reports
`configured:false` and the UI shows an explicit disabled state — no fake voice.
