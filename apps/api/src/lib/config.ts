import dotenv from 'dotenv';
import path from 'node:path';
import { z } from 'zod';
// Source and build both put this file at apps/api/{src,dist}/lib/config.
// Locate the root .env independently of the process working directory.
dotenv.config({ path: path.resolve(__dirname, '../../../../.env') });
const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  DATABASE_URL: z.string().url(),
  WEB_ORIGIN: z.string().url().default('http://localhost:3000'),
  API_PORT: z.coerce.number().int().min(1).max(65535).default(4000),
  TRUST_PROXY: z.coerce.number().int().min(0).max(3).default(0),
  SESSION_SECRET: z.string().min(32),
  REDIS_URL: z.string().url().optional(),
  SMTP_HOST: z.string().optional(), SMTP_PORT: z.coerce.number().int().optional(),
  SMTP_USER: z.string().optional(), SMTP_PASSWORD: z.string().optional(),
  EMAIL_FROM: z.string().optional(),
  GOOGLE_CLIENT_ID: z.string().optional(), GOOGLE_CLIENT_SECRET: z.string().optional(),
  GOOGLE_REDIRECT_URI: z.string().url().optional(),
  LIVEKIT_URL: z.string().url().optional(), LIVEKIT_API_KEY: z.string().optional(), LIVEKIT_API_SECRET: z.string().optional(),
  CLOUDINARY_CLOUD_NAME: z.string().optional(), CLOUDINARY_API_KEY: z.string().optional(), CLOUDINARY_API_SECRET: z.string().optional(),
  STORAGE_PROVIDER: z.enum(['local', 'cloudinary', 's3']).default('local'),
  S3_ENDPOINT: z.string().url().optional(), S3_REGION: z.string().optional(), S3_BUCKET: z.string().optional(),
  S3_ACCESS_KEY_ID: z.string().optional(), S3_SECRET_ACCESS_KEY: z.string().optional(),
  MAX_UPLOAD_MB: z.coerce.number().int().min(1).max(100).default(10)
});
export const config = schema.parse(process.env);
if (config.NODE_ENV === 'production') {
  if (!config.WEB_ORIGIN.startsWith('https://') || (config.GOOGLE_REDIRECT_URI && !config.GOOGLE_REDIRECT_URI.startsWith('https://'))) throw new Error('Production web origin and Google redirect URI must use HTTPS');
  if (config.TRUST_PROXY === 0) throw new Error('Production API must trust only its configured reverse-proxy hops; set TRUST_PROXY and restrict direct API ingress');
  if (config.SESSION_SECRET.includes('replace-with') || !config.SMTP_HOST || !config.EMAIL_FROM) throw new Error('Production requires a strong SESSION_SECRET and SMTP configuration');
  if (config.STORAGE_PROVIDER === 'local') throw new Error('Production requires cloudinary or s3 storage; local disk is not durable/private across instances');
}
if (config.STORAGE_PROVIDER === 'cloudinary' && (!config.CLOUDINARY_CLOUD_NAME || !config.CLOUDINARY_API_KEY || !config.CLOUDINARY_API_SECRET)) throw new Error('Cloudinary credentials are required');
if (config.STORAGE_PROVIDER === 's3' && (!config.S3_BUCKET || !config.S3_ACCESS_KEY_ID || !config.S3_SECRET_ACCESS_KEY)) throw new Error('S3 credentials are required');
export const allowedOrigins = [config.WEB_ORIGIN, ...(config.NODE_ENV !== 'production' && process.env.E2B_SANDBOX_ID ? [`https://3000-${process.env.E2B_SANDBOX_ID}.e2b.app`] : [])];
