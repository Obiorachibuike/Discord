# Security

## Authentication model

- **Passwords**: Argon2id (`@node-rs/argon2`) with sane defaults; policy enforced by Zod
  (≥10 chars, max 256) server-side on register/reset/change.
- **Sessions**: opaque 256-bit random tokens stored **hashed** in `Session`; cookie is
  `HttpOnly`, `SameSite=Lax`, `Secure` in production, `Path=/`. Tokens are never exposed to
  JavaScript — **nothing auth-related is stored in localStorage** (only UI preferences like
  theme/accent live there).
- **CSRF**: double-submit. A readable `aether_csrf` cookie is paired with the
  `x-aether-csrf` header requirement on every write when a session cookie is present;
  mismatch ⇒ 403. Implemented in `packages/server/src/middleware/csrf.ts` +
  `packages/web/src/lib/api.ts`.
- **Password reset / email verification**: single-use tokens stored **hashed** with expiry
  (reset 1h, verification 24h). `forgot` always returns 200 (no account enumeration).
- **Account recovery flows** revoke sessions on password reset; password change revokes all
  *other* sessions.
- **Google OAuth** (optional): the browser sends a Google **ID token** to
  `POST /api/auth/google`, which is verified server-side against Google's JWKS before an
  Aether session is issued. No client secret is handled in the browser.

## Authorization

- **Deny-by-default**: a permission only applies when the resolved bitmask grants it.
- Resolution order: owner bypass → role allow-masks (default role + assigned roles) →
  channel overrides (role then member) → **deny wins**.
- Private channels: `VIEW_CHANNELS` must be explicitly allowed at channel level for the
  role/member — inherited server-level view is not enough.
- The same permission service guards REST **and** every socket event
  (`channel:subscribe`, message create/edit/delete/react, moderation, …).
- Moderation actions (kick/ban/timeout) require their specific bits
  (KICK_MEMBERS / BAN_MEMBERS / MODERATE_MEMBERS) and are recorded in `ModerationAction`
  + `AuditLog`.

## Input & output

- All bodies/queries validated with Zod; unknown fields stripped.
- Parameterized SQL exclusively via Prisma.
- Uploaded files: MIME allowlist + per-kind size caps; generated storage keys (no user path
  traversal); private downloads re-checked per request (uploader prefix or message access).
- HTML is never interpolated raw in the UI (React escaping); messages render as text.

## Transport & headers

- Helmet-equivalent header set: CSP (`default-src 'self'`), HSTS, `X-Frame-Options:
  SAMEORIGIN` (clickjacking), `X-Content-Type-Options`, `Referrer-Policy: no-referrer`,
  `Permissions-Policy`, COOP/CORP.
- Rate limiting on auth endpoints (default 30/min/IP) and API at large (300/min/IP) with
  standard `RateLimit-*` headers.
- CORS allowlist (`CORS_ORIGINS`) with `Access-Control-Allow-Credentials`; the default
  deployment uses the single-origin web proxy so cross-origin is unnecessary.

## Secrets

- All secrets come from environment variables (see `.env.example`); `.env` is git-ignored.
- `SESSION_SECRET` must be ≥32 chars in production (`openssl rand -base64 48`).
- Email/SMTP, storage provider and LiveKit credentials never reach the browser; only
  capability flags (e.g. `voice.configured`) are exposed via `/api/config` and
  `/api/voice/status`.

## Known limitations (documented, not hidden)

- Presence without Redis is process-local — correct in single-node deployments only.
- Content moderation is action/audit based; no automated NSFW scanning.
- Rate limiting is in-memory per node; use a shared store/reverse-proxy limiter in a
  multi-node deployment.
- Email deliverability depends on configured SMTP; `console`/`none` providers are for
  development and are clearly labeled in logs.

## Reporting

Please report security issues privately to the repository maintainers (GitHub Security
Advisories). Do not file public issues for exploitable vulnerabilities.
