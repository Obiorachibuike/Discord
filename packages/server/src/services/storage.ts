import { extname, join, resolve, dirname } from 'node:path';
import { createReadStream, createWriteStream, existsSync, mkdirSync } from 'node:fs';
import { pipeline } from 'node:stream/promises';
import type { Readable } from 'node:stream';
import { v2 as cloudinary } from 'cloudinary';
import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { config } from '../config.js';
import { logger } from '../logger.js';
import { ApiError } from '../errors.js';

export interface StoredObject {
  storageKey: string;
  url: string | null;
  provider: 'local' | 'cloudinary' | 's3';
}

export interface StorageDriver {
  put(input: {
    key: string;
    fileName: string;
    mimeType: string;
    kind: string;
    stream: Readable;
    size: number;
  }): Promise<StoredObject>;
  /** Returns a readable stream for private downloads (local driver). */
  getStream(storageKey: string): Promise<Readable>;
  /** Best-effort direct URL (signed / public). */
  resolveUrl(storageKey: string, mimeType: string): Promise<string | null>;
}

class LocalDriver implements StorageDriver {
  private dir: string;

  constructor(dir: string) {
    this.dir = resolve(dir);
    mkdirSync(this.dir, { recursive: true });
  }

  async put(input: {
    key: string;
    fileName: string;
    mimeType: string;
    kind: string;
    stream: Readable;
    size: number;
  }): Promise<StoredObject> {
    // Keys are server-generated (`<userId>/<uuid><ext>`); keep the directory
    // prefix intact (it doubles as the ownership marker) but sanitize each
    // path segment defensively.
    const safeName = input.key
      .split('/')
      .map((seg) => seg.replace(/[^a-zA-Z0-9_.-]/g, '_'))
      .join('/');
    const target = join(this.dir, safeName);
    if (!target.startsWith(resolve(this.dir))) throw ApiError.badRequest('Invalid file key');
    mkdirSync(dirname(target), { recursive: true });
    await pipeline(input.stream, createWriteStream(target));
    return {
      storageKey: safeName,
      url: `/api/uploads/${encodeURIComponent(safeName)}`,
      provider: 'local',
    };
  }

  async getStream(storageKey: string): Promise<Readable> {
    const safe = storageKey
      .split('/')
      .map((seg) => seg.replace(/[^a-zA-Z0-9_.-]/g, '_'))
      .join('/');
    const target = join(this.dir, safe);
    if (!target.startsWith(resolve(this.dir))) throw ApiError.notFound('File not found');
    if (!existsSync(target)) throw ApiError.notFound('File not found');
    return createReadStream(target);
  }

  async resolveUrl(storageKey: string): Promise<string | null> {
    return `/api/uploads/${encodeURIComponent(storageKey)}`;
  }
}

class CloudinaryDriver implements StorageDriver {
  constructor() {
    cloudinary.config({
      cloud_name: config.CLOUDINARY_CLOUD_NAME,
      api_key: config.CLOUDINARY_API_KEY,
      api_secret: config.CLOUDINARY_API_SECRET,
    });
  }

  async put(input: {
    key: string;
    fileName: string;
    mimeType: string;
    kind: string;
    stream: Readable;
    size: number;
  }): Promise<StoredObject> {
    const folder = input.kind === 'image' ? 'aether/images' : 'aether/files';
    const result = await new Promise<{ secure_url: string; public_id: string }>((res, rej) => {
      const upload = cloudinary.uploader.upload_stream(
        {
          folder,
          resource_type: input.kind === 'image' ? 'image' : 'auto',
          public_id: input.key.replace(extname(input.key), ''),
        },
        (err, r) => (err || !r ? rej(err ?? new Error('Upload failed')) : res(r as { secure_url: string; public_id: string })),
      );
      input.stream.pipe(upload);
    });
    return {
      storageKey: result.public_id,
      url: result.secure_url,
      provider: 'cloudinary',
    };
  }

  async getStream(): Promise<Readable> {
    throw ApiError.badRequest('Use the resolved URL for Cloudinary assets');
  }

  async resolveUrl(storageKey: string): Promise<string | null> {
    return cloudinary.url(storageKey, { secure: true });
  }
}

class S3Driver implements StorageDriver {
  private client: S3Client;

  constructor() {
    this.client = new S3Client({
      region: config.S3_REGION,
      endpoint: config.S3_ENDPOINT,
      forcePathStyle: Boolean(config.S3_ENDPOINT),
      credentials:
        config.S3_ACCESS_KEY_ID && config.S3_SECRET_ACCESS_KEY
          ? {
              accessKeyId: config.S3_ACCESS_KEY_ID,
              secretAccessKey: config.S3_SECRET_ACCESS_KEY,
            }
          : undefined,
    });
  }

  async put(input: {
    key: string;
    fileName: string;
    mimeType: string;
    kind: string;
    stream: Readable;
    size: number;
  }): Promise<StoredObject> {
    await this.client.send(
      new PutObjectCommand({
        Bucket: config.S3_BUCKET,
        Key: input.key,
        Body: input.stream,
        ContentType: input.mimeType,
        ContentLength: input.size,
      }),
    );
    return {
      storageKey: input.key,
      url: await this.resolveUrl(input.key, input.mimeType),
      provider: 's3',
    };
  }

  async getStream(storageKey: string): Promise<Readable> {
    const out = await this.client.send(
      new GetObjectCommand({ Bucket: config.S3_BUCKET, Key: storageKey }),
    );
    return out.Body as unknown as Readable;
  }

  async resolveUrl(storageKey: string, mimeType = 'application/octet-stream'): Promise<string | null> {
    if (config.S3_PUBLIC_URL) return `${config.S3_PUBLIC_URL}/${storageKey}`;
    // Signed URL, valid 1 hour.
    return getSignedUrl(
      this.client,
      new GetObjectCommand({
        Bucket: config.S3_BUCKET,
        Key: storageKey,
        ResponseContentType: mimeType,
      }),
      { expiresIn: 3600 },
    );
  }
}

function buildDriver(): StorageDriver {
  switch (config.STORAGE_DRIVER) {
    case 'cloudinary':
      if (!config.CLOUDINARY_CLOUD_NAME || !config.CLOUDINARY_API_KEY || !config.CLOUDINARY_API_SECRET) {
        logger.warn('storage: cloudinary selected but not fully configured — using local driver');
        return new LocalDriver(config.UPLOAD_DIR);
      }
      return new CloudinaryDriver();
    case 's3':
      if (!config.S3_BUCKET || !config.S3_ACCESS_KEY_ID) {
        logger.warn('storage: s3 selected but not fully configured — using local driver');
        return new LocalDriver(config.UPLOAD_DIR);
      }
      return new S3Driver();
    default:
      return new LocalDriver(config.UPLOAD_DIR);
  }
}

export const storage: StorageDriver = buildDriver();
