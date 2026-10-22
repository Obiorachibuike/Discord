import { createPrisma, type PrismaClient } from '@aether/database';
import { config } from './config.js';

export const prisma: PrismaClient = createPrisma(config.DATABASE_URL);

export async function disconnectPrisma(): Promise<void> {
  await prisma.$disconnect();
}
