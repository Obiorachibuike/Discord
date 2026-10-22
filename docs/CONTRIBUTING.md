# Contributing

Thanks for helping build Aether.

## Dev environment

```bash
npm install
npm run generate --workspace @aether/database
node scripts/run-app.mjs     # embedded PG + API + web, seeded
```

Or against your own PostgreSQL: copy `.env.example` → `.env`, then `npm run migrate &&
npm run seed && npm run dev`.

## Workflow

1. Branch from `main`; keep PRs focused.
2. Add/adjust tests for every behavior change:
   - unit → `packages/server/tests/unit/`
   - REST integration → `packages/server/tests/integration/`
   - realtime → `packages/server/tests/realtime/`
   - browser flows → `packages/web/../e2e/` (Playwright).
3. `npm test` must pass (104 baseline), `npm run typecheck` and `npm run lint` clean.
4. Update docs (`docs/`) when changing API/socket contracts — they are the source of truth
   alongside `packages/shared/src/events.ts` and route files.

## Conventions

- **TypeScript strict** everywhere; shared contracts (Zod schemas, DTOs, socket events,
  permission bits) live in `packages/shared` — never duplicate them per package.
- **Routes are thin**: parse → authorize → service → DTO. Business logic belongs in
  `src/services`.
- **Deny-by-default authorization**: every new channel/server operation must call the
  permission service (REST *and* socket, when applicable).
- **Persist before ack**: anything that must survive a refresh goes to PostgreSQL before the
  API/socket acknowledges it. Ephemeral state (typing, voice activity) is the only exception.
- **No faked integrations**: unconfigured providers degrade with an explicit, honest state
  (see `/api/voice/status` and the voice panel).
- **UI**: shadcn-style components in `packages/web/src/components/ui`; design tokens via
  Tailwind CSS variables; Lucide icons; forms with React Hook Form + Zod.
- **Commits**: imperative subject, body explaining *why* for non-obvious changes.

## Testing notes

- Integration tests run against a throwaway embedded PostgreSQL (auto-provisioned).
- Realtime tests use two real socket clients; when adding events, cover the happy path,
  an authorization failure, and payload validation.
- `node scripts/boot-smoke.mjs` is the fastest full-stack sanity check after infra changes.

## Reporting bugs

Include: repro steps, expected/actual, versions (Node/npm/PG), and relevant logs. For
security issues see `docs/SECURITY.md` — report privately.
