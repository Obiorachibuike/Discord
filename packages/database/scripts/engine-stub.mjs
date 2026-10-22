/**
 * Prisma CLI bootstraps its schema engine from binaries.prisma.sh in some
 * environments. In offline/locked-down environments we point
 * PRISMA_SCHEMA_ENGINE_BINARY at this harmless stub so that `prisma generate`
 * (which validates the schema via WASM) can proceed. Migrations are applied by
 * src/migrate.ts (plain SQL), so the real schema engine binary is not required.
 */
import { chmodSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

const target = process.env.PRISMA_SCHEMA_ENGINE_BINARY || '/tmp/.prisma-stub';
if (!existsSync(target)) {
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, '#!/bin/sh\nexit 0\n');
  chmodSync(target, 0o755);
}
