import 'dotenv/config';
import { defineConfig } from '@playwright/test';
import chromium from '@sparticuz/chromium';

// E2E uses a disposable _test database and different ports from the developer preview.
const database = process.env.TEST_DATABASE_URL || 'postgresql://postgres:postgres@127.0.0.1:5432/cove_test';
const baseURL = 'http://127.0.0.1:3100';
const binary = process.env.COVE_CHROMIUM_PATH || '/tmp/chromium';

export default defineConfig({
  testDir: 'tests/e2e',
  globalSetup: './tests/e2e/global-setup.ts',
  timeout: 90_000,
  expect: { timeout: 12_000 },
  retries: process.env.CI ? 1 : 0,
  workers: 1,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : 'list',
  use: {
    baseURL,
    viewport: { width: 1365, height: 850 },
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure',
    launchOptions: {
      executablePath: binary,
      args: chromium.args.filter(arg => !['--disable-web-security', '--allow-running-insecure-content', '--single-process'].includes(arg)),
      env: { ...process.env, LD_LIBRARY_PATH: ['/tmp/cove-chrome-libs/lib', process.env.LD_LIBRARY_PATH].filter(Boolean).join(':') }
    }
  },
  webServer: [
    { command: 'npm run dev -w @cove/api', url: 'http://127.0.0.1:4100/api/ready', timeout: 120_000, reuseExistingServer: false,
      env: { ...process.env, DATABASE_URL: database, API_PORT: '4100', WEB_ORIGIN: baseURL, NODE_ENV: 'test' } },
    { command: 'npm run dev -w @cove/web', url: `${baseURL}/login`, timeout: 180_000, reuseExistingServer: false,
      env: { ...process.env, WEB_PORT: '3100', API_INTERNAL_URL: 'http://127.0.0.1:4100', COVE_E2E: '1', NEXT_TELEMETRY_DISABLED: '1' } }
  ]
});
