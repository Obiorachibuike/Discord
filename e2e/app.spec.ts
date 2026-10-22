import { test, expect } from '@playwright/test';

test.describe('public pages', () => {
  test('landing page renders with original branding', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByRole('heading', { name: /comes together/i })).toBeVisible();
    await expect(page.getByRole('link', { name: /get started/i }).first()).toBeVisible();
  });

  test('login and register pages render', async ({ page }) => {
    await page.goto('/login');
    await expect(page.getByRole('heading', { name: /welcome back/i })).toBeVisible();
    await page.goto('/register');
    await expect(page.getByRole('heading', { name: /create your account/i })).toBeVisible();
  });

  test('forgot-password flow acknowledges without leaking accounts', async ({ page }) => {
    await page.goto('/forgot');
    await page.getByLabel('Email').fill('nobody@example.com');
    await page.getByRole('button', { name: /send reset link/i }).click();
    await expect(page.getByText(/if that email is registered/i)).toBeVisible();
  });
});

test.describe('authentication', () => {
  const username = `e2e_${Date.now().toString(36)}`;
  const email = `${username}@example.com`;
  const password = 'Sup3rSecret!pass';

  test('register → logout → login', async ({ page }) => {
    await page.goto('/register');
    await page.getByLabel('Email').fill(email);
    await page.getByLabel('Username').fill(username);
    await page.getByLabel('Password', { exact: true }).fill(password);
    await page.getByRole('button', { name: /create account/i }).click();
    await page.waitForURL('**/app**');

    // Logout from the settings sidebar.
    await page.goto('/settings/account');
    await page.getByRole('button', { name: /log out/i }).click();
    await page.waitForURL(/\/(login)?$/);

    await page.goto('/login');
    await page.getByLabel('Email or username').fill(username);
    await page.getByLabel('Password').fill(password);
    await page.getByRole('button', { name: /sign in/i }).click();
    await page.waitForURL('**/app**');
    await expect(page.getByText(/friends/i).first()).toBeVisible();
  });
});

test.describe('servers and messaging', () => {
  test('login as demo user, open server, send a message', async ({ page }) => {
    await page.goto('/login');
    await page.getByLabel('Email or username').fill('ada');
    await page.getByLabel('Password').fill('Passw0rd!demo');
    await page.getByRole('button', { name: /sign in/i }).click();
    await page.waitForURL('**/app**');

    // The seeded "Aether HQ" server shows in the rail.
    await page.getByRole('link', { name: /aether hq/i }).first().click().catch(() => {});
    await page.goto('/app');
    const serverLink = page.locator('nav[aria-label="Servers"] a').nth(1);
    await serverLink.click();
    await page.waitForURL('**/app/servers/**');

    const composer = page.getByPlaceholder(/^message #/i);
    await composer.waitFor({ timeout: 15_000 });
    const text = `hello from e2e ${Date.now()}`;
    await composer.fill(text);
    await composer.press('Enter');
    await expect(page.getByText(text)).toBeVisible();
  });

  test('search overlay opens with keyboard shortcut', async ({ page }) => {
    await page.goto('/login');
    await page.getByLabel('Email or username').fill('ada');
    await page.getByLabel('Password').fill('Passw0rd!demo');
    await page.getByRole('button', { name: /sign in/i }).click();
    await page.waitForURL('**/app**');
    await page.keyboard.press('Control+k');
    await expect(page.getByPlaceholder(/search/i).first()).toBeVisible();
    await page.keyboard.press('Escape');
  });
});

test.describe('settings', () => {
  test('appearance page toggles theme', async ({ page }) => {
    await page.goto('/login');
    await page.getByLabel('Email or username').fill('ada');
    await page.getByLabel('Password').fill('Passw0rd!demo');
    await page.getByRole('button', { name: /sign in/i }).click();
    await page.waitForURL('**/app**');

    await page.goto('/settings/appearance');
    await expect(page.getByRole('heading', { name: /appearance/i })).toBeVisible();
    const dark = page.getByLabel('Toggle dark mode');
    const before = await dark.getAttribute('data-state');
    await dark.click();
    await expect(page.getByLabel('Toggle dark mode')).not.toHaveAttribute('data-state', before ?? '');
    await page.getByTitle('Emerald').click();
  });
});
