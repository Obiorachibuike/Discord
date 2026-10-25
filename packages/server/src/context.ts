import { createPrisma, type PrismaClient } from '@aether/database';
import { config, resolveDatabaseUrl } from './config.js';
import { ApiError } from './errors.js';

const globalForPrisma = globalThis as unknown as {
  __aetherPrisma?: { url: string; client: PrismaClient };
};

export function getDatabaseUrl(): string {
  return resolveDatabaseUrl(process.env) || config.DATABASE_URL;
}

export function getPrisma(): PrismaClient {
  const url = getDatabaseUrl();
  if (!url) {
    throw ApiError.unavailable(
      'Database is not configured. Set DATABASE_URL (or connect Vercel Postgres / Neon) in your project environment variables.',
    );
  }
  if (!globalForPrisma.__aetherPrisma || globalForPrisma.__aetherPrisma.url !== url) {
    globalForPrisma.__aetherPrisma = {
      url,
      client: createPrisma(url),
    };
  }
  return globalForPrisma.__aetherPrisma.client;
}

export const prisma: PrismaClient = new Proxy({} as PrismaClient, {
  get(_target, prop, _receiver) {
    const client = getPrisma();
    const value = Reflect.get(client as object, prop, client);
    return typeof value === 'function' ? value.bind(client) : value;
  },
});

export async function disconnectPrisma(): Promise<void> {
  if (globalForPrisma.__aetherPrisma) {
    await globalForPrisma.__aetherPrisma.client.$disconnect();
    delete globalForPrisma.__aetherPrisma;
  }
}
