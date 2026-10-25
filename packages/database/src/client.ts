import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from './generated/prisma/client.js';

export function createPrisma(connectionString: string): PrismaClient {
  const max = process.env.PG_POOL_MAX
    ? Number(process.env.PG_POOL_MAX)
    : process.env.VERCEL
      ? 5
      : 10;
  const adapter = new PrismaPg({ connectionString, max });
  return new PrismaClient({ adapter });
}

export * from './generated/prisma/client.js';
