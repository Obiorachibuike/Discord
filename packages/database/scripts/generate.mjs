import { spawnSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

/**
 * Runs `prisma generate`. If the Prisma CLI cannot download its schema engine
 * (offline / locked-down environments where binaries.prisma.sh is unreachable),
 * retries with PRISMA_SCHEMA_ENGINE_BINARY pointed at a harmless stub. Schema
 * validation itself is WASM-based, so generation succeeds without the engine;
 * SQL migrations are applied by src/migrate.ts.
 */
const run = (env) =>
  spawnSync('npx', ['prisma', 'generate'], {
    stdio: 'inherit',
    env: { ...process.env, ...env },
    shell: false,
  });

let result = run({});
if (result.status !== 0) {
  const stub = process.env.PRISMA_SCHEMA_ENGINE_BINARY || '/tmp/.prisma-stub';
  if (!existsSync(stub)) {
    mkdirSync(dirname(stub), { recursive: true });
    writeFileSync(stub, '#!/bin/sh\nexit 0\n');
    chmodSync(stub, 0o755);
  }
  console.log('[db:generate] retrying with PRISMA_SCHEMA_ENGINE_BINARY stub…');
  result = run({ PRISMA_SCHEMA_ENGINE_BINARY: stub });
}
process.exit(result.status ?? 1);
