import { Queue, Worker } from 'bullmq';
import { db } from '@cove/db';
import { getRedis } from '../lib/redis';
import { deleteObject } from '../services/storage';
import { logger } from '../lib/logger';

export async function cleanupOrphanUploads() {
  const cutoff = new Date(Date.now() - 24 * 3600_000);
  const old = await db.messageAttachment.findMany({ where: { messageId: null, createdAt: { lt: cutoff } }, take: 100 });
  let removed = 0;
  for (const attachment of old) {
    const didRemove = await db.$transaction(async tx => {
      // A profile/icon setter takes FOR SHARE on the same row. Recheck under an
      // exclusive lock so a stale list cannot delete a newly referenced file.
      // SKIP LOCKED also lets overlapping cleanup runs safely split the work.
      const rows = await tx.$queryRaw<{ id: string }[]>`
        SELECT "id" FROM "MessageAttachment"
        WHERE "id" = ${attachment.id}::uuid AND "messageId" IS NULL
          AND "createdAt" < ${cutoff} FOR UPDATE SKIP LOCKED`;
      if (!rows.length) return false;
      const url = `/api/attachments/${attachment.id}`;
      if (await tx.user.count({ where: { avatarUrl: url } }) || await tx.server.count({ where: { iconUrl: url } })) return false;
      await deleteObject(attachment);
      await tx.messageAttachment.delete({ where: { id: attachment.id } });
      return true;
    }, { timeout: 30_000 });
    if (didRemove) removed++;
  }
  logger.info({ scanned: old.length, removed }, 'orphan attachment cleanup');
  return removed;
}
export async function startCleanupWorker() {
  const redis = getRedis();
  if (!redis) return; // Run `npm run cleanup:orphans` on a schedule without Redis.
  const queue = new Queue('attachment-cleanup', { connection: redis });
  await queue.add('remove-orphans', {}, { repeat: { every: 3600_000 }, removeOnComplete: 20, removeOnFail: 50 });
  const worker = new Worker('attachment-cleanup', cleanupOrphanUploads, { connection: redis, concurrency: 1 });
  worker.on('failed', (job, error) => logger.error({ jobId: job?.id, err: error }, 'background job failed'));
  return async () => { await worker.close(); await queue.close(); };
}
