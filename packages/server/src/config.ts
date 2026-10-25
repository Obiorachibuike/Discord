import { z } from 'zod';

export function resolveDatabaseUrl(env: NodeJS.ProcessEnv = process.env): string {
  return (
    env.DATABASE_URL ||
    env.POSTGRES_PRISMA_URL ||
    env.POSTGRES_URL ||
    env.NEON_DATABASE_URL ||
    ''
  ).trim();
}

function defaultWebUrl(env: NodeJS.ProcessEnv): string {
  const vercelHost = env.VERCEL_PROJECT_PRODUCTION_URL || env.VERCEL_URL;
  if (vercelHost) return `https://${vercelHost}`;
  return 'http://localhost:3000';
}

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().min(1).max(65535).default(4000),
  HOST: z.string().default('0.0.0.0'),
  DATABASE_URL: z.string().default(''),
  /** Comma-separated list of allowed browser origins. */
  CORS_ORIGINS: z.string().default('http://localhost:3000'),
  SESSION_SECRET: z.string().min(32).default('dev-only-session-secret-change-me-000000'),
  SESSION_TTL_HOURS: z.coerce.number().int().min(1).max(24 * 90).default(24 * 14),
  COOKIE_SECURE: z
    .enum(['true', 'false'])
    .default('false')
    .transform((v) => v === 'true'),
  WEB_URL: z.string().optional(),

  REDIS_URL: z.string().optional(),

  /** smtp | console (console logs email bodies — development only) */
  EMAIL_PROVIDER: z.enum(['smtp', 'console', 'none']).default('console'),
  SMTP_URL: z.string().optional(),
  EMAIL_FROM: z.string().default('Aether <no-reply@aether.local>'),

  /** local | cloudinary | s3 (s3 also covers Cloudflare R2) */
  STORAGE_DRIVER: z.enum(['local', 'cloudinary', 's3']).default('local'),
  UPLOAD_DIR: z.string().optional(),
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
    .optional()
    .transform((v) => (v === undefined ? undefined : v === 'true')),
});

export type AppConfig = Omit<z.infer<typeof envSchema>, 'WEB_URL' | 'UPLOAD_DIR' | 'TRUST_PROXY'> & {
  WEB_URL: string;
  UPLOAD_DIR: string;
  TRUST_PROXY: boolean;
  corsOrigins: string[];
  hasDatabase: boolean;
  isProd: boolean;
  isTest: boolean;
  isServerless: boolean;
};

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const parsed = envSchema.safeParse({
    ...env,
    DATABASE_URL: resolveDatabaseUrl(env),
  });
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((i) => `${i.path.join('.')}: ${i.message}`)
      .join('\n  ');
    throw new Error(`Invalid environment configuration:\n  ${issues}`);
  }
  const c = parsed.data;
  const isServerless = env.VERCEL === '1' || Boolean(env.AWS_LAMBDA_FUNCTION_NAME);
  const webUrl = c.WEB_URL || defaultWebUrl(env);
  const uploadDir = c.UPLOAD_DIR || (isServerless ? '/tmp/aether-uploads' : 'uploads');
  const trustProxy = c.TRUST_PROXY ?? isServerless;

  const extraOrigins = [
    env.VERCEL_URL ? `https://${env.VERCEL_URL}` : '',
    env.VERCEL_BRANCH_URL ? `https://${env.VERCEL_BRANCH_URL}` : '',
    env.VERCEL_PROJECT_PRODUCTION_URL ? `https://${env.VERCEL_PROJECT_PRODUCTION_URL}` : '',
    webUrl,
  ].filter(Boolean);

  const corsOrigins = Array.from(
    new Set([
      ...c.CORS_ORIGINS.split(',').map((s) => s.trim()).filter(Boolean),
      ...extraOrigins,
    ]),
  );

  return {
    ...c,
    WEB_URL: webUrl,
    UPLOAD_DIR: uploadDir,
    TRUST_PROXY: trustProxy,
    corsOrigins,
    hasDatabase: Boolean(c.DATABASE_URL),
    isProd: c.NODE_ENV === 'production',
    isTest: c.NODE_ENV === 'test',
    isServerless,
  };
}

export const config = loadConfig();
