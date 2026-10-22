import { randomUUID } from 'node:crypto';
import { extname } from 'node:path';
import {
  ALLOWED_FILE_MIME,
  LIMITS,
  UPLOAD_KINDS,
  type UploadKind,
} from '@aether/shared';
import { prisma } from '../context.js';
import { ApiError } from '../errors.js';
import { storage } from './storage.js';
import { toAttachment } from '../utils/dto.js';

function classifyMime(mime: string): UploadKind {
  if (mime.startsWith('image/')) return 'image';
  if (mime.startsWith('video/')) return 'video';
  if (mime.startsWith('audio/')) return 'audio';
  return 'file';
}

export class UploadService {
  async createAttachment(input: {
    userId: string;
    fileName: string;
    mimeType: string;
    size: number;
    stream: NodeJS.ReadableStream & { truncated?: boolean };
  }) {
    if (!ALLOWED_FILE_MIME.includes(input.mimeType as (typeof ALLOWED_FILE_MIME)[number])) {
      throw ApiError.badRequest(`File type ${input.mimeType} is not allowed`);
    }
    const maxForKind =
      classifyMime(input.mimeType) === 'image' ? LIMITS.imageMaxBytes : LIMITS.uploadMaxBytes;
    if (input.size <= 0 || input.size > maxForKind) {
      throw ApiError.badRequest(
        `File exceeds the ${Math.floor(maxForKind / (1024 * 1024))} MB limit`,
      );
    }
    const kind = classifyMime(input.mimeType);
    const safeBase = (input.fileName || 'file')
      .replace(/[^a-zA-Z0-9_.-]/g, '_')
      .slice(-80) || 'file';
    const key = `${input.userId}/${randomUUID()}${extname(safeBase)}`;
    const stored = await storage.put({
      key,
      fileName: safeBase,
      mimeType: input.mimeType,
      kind,
      stream: input.stream as never,
      size: input.size,
    });
    const attachment = await prisma.messageAttachment.create({
      data: {
        messageId: null, // bound to a message when sent
        fileName: safeBase,
        fileSize: input.size,
        mimeType: input.mimeType,
        kind,
        storageKey: stored.storageKey,
        url: stored.url,
      },
    });
    return toAttachment(attachment);
  }

  /** Stores a user avatar image and returns its public URL. */
  async putAvatar(input: {
    userId: string;
    fileName: string;
    mimeType: string;
    size: number;
    stream: NodeJS.ReadableStream & { truncated?: boolean };
  }): Promise<{ url: string }> {
    if (!/^image\/(png|jpeg|gif|webp)$/.test(input.mimeType)) {
      throw ApiError.badRequest('Avatars must be PNG, JPEG, GIF or WebP images');
    }
    const max = LIMITS.imageMaxBytes;
    if (input.size <= 0 || input.size > max) {
      throw ApiError.badRequest(`Image exceeds the ${Math.floor(max / (1024 * 1024))} MB limit`);
    }
    const key = `avatars/${input.userId}/${randomUUID()}${extname(input.fileName || 'a.png') || '.png'}`;
    const stored = await storage.put({
      key,
      fileName: input.fileName || 'avatar.png',
      mimeType: input.mimeType,
      kind: 'image',
      stream: input.stream as never,
      size: input.size,
    });
    const url = stored.url ?? (await storage.resolveUrl(stored.storageKey, input.mimeType));
    if (!url) throw ApiError.internal('Could not resolve a URL for the uploaded avatar');
    return { url };
  }

  /**
   * Orphan attachments (uploaded but never sent) are the only record of a
   * private object; keep ownership in the storage key prefix (userId/…).
   */
  assertOwned(storageKey: string, userId: string): void {
    if (!storageKey.startsWith(`${userId}/`)) {
      throw ApiError.forbidden('You do not own this file');
    }
  }

  async serve(storageKey: string, _userId: string) {
    const attachment = await prisma.messageAttachment.findFirst({
      where: { storageKey },
    });
    // Ownership: uploader prefix OR attached to a message the user can see is
    // checked by the caller route; here we only resolve the stream/URL.
    const url = await storage.resolveUrl(storageKey, attachment?.mimeType ?? '');
    return { attachment, url };
  }

  getStream(storageKey: string) {
    return storage.getStream(storageKey);
  }

  kinds(): readonly UploadKind[] {
    return UPLOAD_KINDS;
  }
}

export const uploads = new UploadService();
