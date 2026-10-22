// One-shot maintenance job for single-instance installations without Redis.
// Run from the repository root; never invoke against the wrong DATABASE_URL.
import 'dotenv/config';
import { db } from '@cove/db';
import { cleanupOrphanUploads } from '../apps/api/src/workers/cleanup';
async function main() {
  try { console.log(`Removed ${await cleanupOrphanUploads()} unused uploads.`); }
  finally { await db.$disconnect(); }
}
main().catch(error => { console.error('Upload cleanup failed:', error); process.exitCode = 1; });
