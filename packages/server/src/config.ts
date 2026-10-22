import { z } from 'zod';

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().min(1).max(65535).default(4000),
  HOST: z.string().default('0.0.0.0'),
  DATABASE_URL: z.string().min(1),
  /** Comma-separated list of allowed browser origins. */
  CORS_ORIGINS: z.string().default('http://localhost:3000'),
  SESSION_SECRET: z.string().min(32).default('dev-only-session-secret-change-me-000000'),
  SESSION_TTL_HOURS: z.coerce.number().int().min(1).max(24 * 90).default(24 * 14),
  COOKIE_SECURE: z
    .enum(['true', 'false'])
    .default('false')
    .transform((v) => v === 'true'),
  WEB_URL: z.string().default('http://localhost:3000'),

  REDIS_URL: z.string().optional(),

  /** smtp | console (console logs email bodies — development only) */
  EMAIL_PROVIDER: z.enum(['smtp', 'console', 'none']).default('console'),
  SMTP_URL: z.string().optional(),
  EMAIL_FROM: z.string().default('Aether <no-reply@aether.local>'),

  /** local | cloudinary | s3 (s3 also covers Cloudflare R2) */
  STORAGE_DRIVER: z.enum(['local', 'cloudinary', 's3']).default('local'),
  UPLOAD_DIR: z.string().default('uploads'),
  CLOUDINARY_CLOUD_NAME: z.string().optional(),
  CLOUDINARY_API_KEY: z.string().optional(),
  CLOUDINARY_API_SECRET: z.string().optional(),
  S3_ENDPOINT: z.string().optional(),
  S3_REGION: z.string().default('auto'),
  S3_BUCKET: z.string().optional(),
  S3_ACCESS_KEY_ID: z.string().optional(),
  S3_SECRET_ACCESS_KEY: z.string().optional(),
  S3_PUBLIC_URL: z.string().optional(),

  LIVEKIT_URL: z.string().optional(),
  LIVEKIT_API_KEY: z.string().optional(),
  LIVEKIT_API_SECRET: z.string().optional(),
  VOICE_MAX_PARTICIPANTS: z.coerce.number().int().min(2).max(99).default(25),

  GOOGLE_CLIENT_ID: z.string().optional(),

  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),
  /** Requests per minute on auth endpoints (login/register/reset). */
  AUTH_RATE_LIMIT: z.coerce.number().int().min(1).max(100000).default(30),
  /** Requests per minute on general API endpoints. */
  API_RATE_LIMIT: z.coerce.number().int().min(1).max(100000).default(300),
  TRUST_PROXY: z
    .enum(['true', 'false'])
    .default('false')
    .transform((v) => v === 'true'),
});

export type AppConfig = z.infer<typeof envSchema> & {
  corsOrigins: string[];
  isProd: boolean;
  isTest: boolean;
};

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const parsed = envSchema.safeParse(env);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((i) => `${i.path.join('.')}: ${i.message}`)
      .join('\n  ');
    throw new Error(`Invalid environment configuration:\n  ${issues}`);
  }
  const c = parsed.data;
  return {
    ...c,
    corsOrigins: c.CORS_ORIGINS.split(',').map((s) => s.trim()).filter(Boolean),
    isProd: c.NODE_ENV === 'production',
    isTest: c.NODE_ENV === 'test',
  };
}

export const config = loadConfig();
