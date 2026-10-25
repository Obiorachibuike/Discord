import type { Express } from 'express';
import { createApp } from './app.js';

const globalForServerless = globalThis as unknown as {
  __aetherExpressApp?: Express;
};

/**
 * Returns a cached Express application instance for serverless HTTP handlers
 * (e.g. Next.js / Vercel API routes).
 */
export function getServerlessApp(): Express {
  if (!globalForServerless.__aetherExpressApp) {
    globalForServerless.__aetherExpressApp = createApp();
  }
  return globalForServerless.__aetherExpressApp;
}
