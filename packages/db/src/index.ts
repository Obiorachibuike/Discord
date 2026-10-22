import dotenv from 'dotenv';
import path from 'node:path';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';

// Source and compiled files live at packages/db/{src,dist}/index. Load the
// repository .env regardless of the caller's working directory; explicit
// process environment variables still override the file.
dotenv.config({ path: path.resolve(__dirname, '../../../.env') });
if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required');
const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL });
export const db = new PrismaClient({ adapter, log: ['error', 'warn'] });
export { Prisma, Permission, ChannelKind, Presence, NotificationKind } from '@prisma/client';
export type { User, Server, Channel, Message, Conversation } from '@prisma/client';
