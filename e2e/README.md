# End-to-end tests

Playwright specs for the full Aether stack.

## Running

```bash
# 1. start the stack (embedded PG + API + web on :3000)
node scripts/run-app.mjs

# 2. install browsers (one-time) and run
npx playwright install chromium
npm run test:e2e
```

The Playwright browser CDN must be reachable for `npx playwright install`; in restricted
networks this download fails and the suite cannot execute — the specs remain the canonical
description of the browser flows.

Demo credentials used by specs: `ada` / `Passw0rd!demo` (from `npm run seed`).
