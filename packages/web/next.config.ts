import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { NextConfig } from 'next';

const monorepoRoot = join(dirname(fileURLToPath(import.meta.url)), '../..');
const API_ORIGIN = process.env.API_ORIGIN?.trim();

const nextConfig: NextConfig = {
  reactStrictMode: true,
  transpilePackages: ['@aether/shared'],
  outputFileTracingRoot: monorepoRoot,
  outputFileTracingIncludes: {
    '/api/[[...path]]': ['../../packages/database/prisma/migrations/**/*'],
  },
  serverExternalPackages: [
    '@aether/server',
    '@aether/database',
    '@node-rs/argon2',
    'pg',
    '@prisma/client',
    '@prisma/adapter-pg',
    'pino',
    'pino-http',
    'ioredis',
    'cloudinary',
    'nodemailer',
    'express',
  ],
  async rewrites() {
    // Only proxy /api and /socket.io when an upstream API_ORIGIN is explicitly provided.
    // On Vercel (full-stack serverless), /api/* is served directly by src/pages/api/[[...path]].ts.
    if (!API_ORIGIN) return [];
    return [
      { source: '/api/:path*', destination: `${API_ORIGIN}/api/:path*` },
      { source: '/socket.io/:path*', destination: `${API_ORIGIN}/socket.io/:path*` },
    ];
  },
  images: {
    remotePatterns: [
      { protocol: 'https', hostname: 'res.cloudinary.com' },
      { protocol: 'http', hostname: 'localhost' },
    ],
  },
};

export default nextConfig;
