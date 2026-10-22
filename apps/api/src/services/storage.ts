import path from 'node:path';
import fs from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { v2 as cloudinary } from 'cloudinary';
import { S3Client, PutObjectCommand, DeleteObjectCommand, GetObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { config } from '../lib/config';
import { HttpError } from '../lib/errors';
import { Prisma } from '@cove/db';
import { id } from '@cove/shared';

const localDir = path.resolve(process.cwd(), process.cwd().endsWith('apps/api') ? '../../.local-uploads' : '.local-uploads');
const media = new Set(['image/png','image/jpeg','image/webp','image/gif','application/pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'video/mp4','video/webm']);
const docs = new Set(['.txt','.md','.csv']);
const s3 = config.STORAGE_PROVIDER === 's3' ? new S3Client({ region: config.S3_REGION || 'auto', endpoint: config.S3_ENDPOINT,
  credentials: { accessKeyId: config.S3_ACCESS_KEY_ID!, secretAccessKey: config.S3_SECRET_ACCESS_KEY! } }) : null;
if (config.STORAGE_PROVIDER === 'cloudinary') cloudinary.config({ cloud_name: config.CLOUDINARY_CLOUD_NAME, api_key: config.CLOUDINARY_API_KEY, api_secret: config.CLOUDINARY_API_SECRET, secure: true });

export async function inspectFile(buffer: Buffer, originalName: string) {
  if (!buffer.length || buffer.length > config.MAX_UPLOAD_MB * 1024 * 1024) throw new HttpError(413, 'FILE_TOO_LARGE', `Files must be under ${config.MAX_UPLOAD_MB} MB.`);
  const safeName = path.basename(originalName).replace(/[^a-zA-Z0-9_. -]/g, '_').slice(0, 120).replace(/^\.+/, '') || 'attachment';
  // Dynamic import keeps this ESM-only parser compatible with the CommonJS API build.
  const { fileTypeFromBuffer } = await import('file-type');
  const detected = await fileTypeFromBuffer(buffer);
  let mime: string | undefined = detected?.mime;
  if (!mime && docs.has(path.extname(safeName).toLowerCase()) && !buffer.includes(0) && new TextDecoder('utf-8', { fatal: true }).decode(buffer)) mime = 'text/plain';
  if (!mime || !media.has(mime) && mime !== 'text/plain') throw new HttpError(415, 'UNSUPPORTED_FILE', 'Upload a supported image, PDF, document, text file, or video.');
  // Refuse files whose claimed filename extension contradicts the detected type.
  const extension = path.extname(safeName).toLowerCase();
  const allowedExt: Record<string, string[]> = {
    'image/png': ['.png'], 'image/jpeg': ['.jpg','.jpeg'], 'image/webp': ['.webp'], 'image/gif': ['.gif'],
    'application/pdf': ['.pdf'], 'application/vnd.openxmlformats-officedocument.wordprocessingml.document': ['.docx'],
    'video/mp4': ['.mp4'], 'video/webm': ['.webm'], 'text/plain': ['.txt','.md','.csv']
  };
  if (!allowedExt[mime]?.includes(extension)) throw new HttpError(415, 'UNSUPPORTED_FILE', 'The file extension does not match its contents.');
  return { mime, safeName };
}
export async function store(buffer: Buffer, mime: string) {
  const key = `cove/${randomUUID()}`;
  if (config.STORAGE_PROVIDER === 'local') {
    await fs.mkdir(localDir, { recursive: true, mode: 0o700 });
    const localKey = key.replace('/', '_');
    await fs.writeFile(path.join(localDir, localKey), buffer, { flag: 'wx', mode: 0o600 });
    return { provider: 'local', storageKey: localKey };
  }
  if (config.STORAGE_PROVIDER === 's3' && s3) {
    await s3.send(new PutObjectCommand({ Bucket: config.S3_BUCKET!, Key: key, Body: buffer, ContentType: mime }));
    return { provider: 's3', storageKey: key };
  }
  const resource_type = mime.startsWith('video/') ? 'video' : mime.startsWith('image/') ? 'image' : 'raw';
  const result = await new Promise<{ public_id: string }>((resolve, reject) => {
    const stream = cloudinary.uploader.upload_stream({ public_id: key, overwrite: false, type: 'authenticated', resource_type }, (error, result) => error ? reject(error) : result ? resolve(result) : reject(new Error('Cloudinary returned no upload result')));
    stream.end(buffer);
  });
  return { provider: 'cloudinary', storageKey: `${resource_type}:${result.public_id}` };
}
export async function accessObject(attachment: { provider: string; storageKey: string; mimeType: string; filename: string }) {
  if (attachment.provider === 'local') return { localPath: path.join(localDir, path.basename(attachment.storageKey)) };
  if (attachment.provider === 's3' && s3) return { url: await getSignedUrl(s3, new GetObjectCommand({ Bucket: config.S3_BUCKET!, Key: attachment.storageKey,
    ResponseContentDisposition: `attachment; filename="${attachment.filename.replace(/["\\\r\n]/g, '_')}"` }), { expiresIn: 60 }) };
  if (attachment.provider === 'cloudinary') {
    const [resource_type, ...parts] = attachment.storageKey.split(':');
    const publicId = parts.join(':');
    return { url: cloudinary.utils.private_download_url(publicId, path.extname(attachment.filename).slice(1), {
      resource_type: resource_type || 'raw', type: 'authenticated', expires_at: Math.floor(Date.now() / 1000) + 60
    }) };
  }
  throw new HttpError(503, 'STORAGE_UNAVAILABLE', 'This attachment is temporarily unavailable.');
}
// Hold a shared row lock through an avatar/icon assignment. The cleanup worker
// takes an exclusive lock before deleting an old unclaimed upload, so a profile
// cannot start referring to a file while its deletion is in flight.
export async function lockOwnedImage(tx: Prisma.TransactionClient, url: string, userId: string) {
  const attachmentId = url.split('/').pop()!;
  if (!id.safeParse(attachmentId).success) return false;
  const rows = await tx.$queryRaw<{ id: string }[]>`
    SELECT "id" FROM "MessageAttachment"
    WHERE "id" = ${attachmentId}::uuid AND "uploadedById" = ${userId}::uuid
      AND "mimeType" LIKE 'image/%' FOR SHARE`;
  return rows.length > 0;
}
export async function deleteObject(attachment: { provider: string; storageKey: string }) {
  if (attachment.provider === 'local') await fs.unlink(path.join(localDir, path.basename(attachment.storageKey))).catch(error => { if (error.code !== 'ENOENT') throw error; });
  else if (attachment.provider === 's3' && s3) await s3.send(new DeleteObjectCommand({ Bucket: config.S3_BUCKET!, Key: attachment.storageKey }));
  else if (attachment.provider === 'cloudinary' && config.STORAGE_PROVIDER === 'cloudinary') {
    const [resource_type, ...parts] = attachment.storageKey.split(':');
    await cloudinary.uploader.destroy(parts.join(':'), { resource_type: resource_type || 'raw', type: 'authenticated' });
  } else throw new HttpError(503, 'STORAGE_UNAVAILABLE', 'This attachment provider is unavailable; keep its metadata for reconciliation.');
}
