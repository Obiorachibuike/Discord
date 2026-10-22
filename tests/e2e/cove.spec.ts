import { test, expect, type Page } from '@playwright/test';

const password = 'Cove-test-password-2026!';

async function register(page: Page, username: string, name: string, destination: 'app'|'invite' = 'app') {
  await page.getByLabel('Display name').fill(name);
  await page.getByLabel('Username').fill(username);
  await page.getByLabel('Email address').fill(`${username}@example.test`);
  await page.getByLabel('Password', { exact: true }).fill(password);
  await page.getByRole('button', { name: 'Create your account' }).click();
  if (destination === 'app') {
    await expect(page).toHaveURL(/\/app(?:\?|$)/);
    await expect(page.getByRole('heading', { name: 'Friends' })).toBeVisible();
  } else await expect(page).toHaveURL(/\/invite\/[a-f0-9]{64}/);
}

async function createCommunity(page: Page, name: string) {
  await page.getByRole('button', { name: 'Create a community' }).click();
  await page.getByRole('dialog').getByLabel('COMMUNITY NAME').fill(name);
  await page.getByRole('dialog').getByRole('button', { name: 'Create community' }).click();
  await expect(page).toHaveURL(/\/app\/servers\/[a-f0-9-]+\/channels\/[a-f0-9-]+/);
  await expect(page.getByRole('heading', { name: 'welcome', exact: true })).toBeVisible();
}

test('sign up, create a community, send persistent messages, and search', async ({ page }) => {
  await page.goto('/register');
  await register(page, 'e2e_alex', 'Alex Rivers');
  await createCommunity(page, 'Orchard Studio');
  await page.getByRole('link', { name: 'general', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'general', exact: true })).toBeVisible();
  const text = 'Plum orbit beacon from the browser';
  await page.getByPlaceholder('Message #channel...').fill(text);
  await page.getByRole('button', { name: 'Send message' }).click();
  await expect(page.getByRole('log', { name: 'Messages' }).getByText(text, { exact: true })).toBeVisible();
  await page.reload();
  await expect(page.getByRole('log', { name: 'Messages' }).getByText(text, { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Search messages' }).click();
  const dialog = page.getByRole('dialog', { name: 'Search messages' });
  await dialog.getByPlaceholder('Search for a word or phrase...').fill('plum orbit beacon');
  await dialog.getByRole('button', { name: 'Search' }).click();
  await expect(dialog.getByText(text)).toBeVisible();
});

test('invite a second account, receive a live message, and navigate on mobile', async ({ browser }) => {
  const ownerContext = await browser.newContext();
  const guestContext = await browser.newContext();
  try {
    const owner = await ownerContext.newPage();
    const guest = await guestContext.newPage();
    await owner.goto('/register');
    await register(owner, 'e2e_sam', 'Sam Reed');
    await createCommunity(owner, 'Cove Test Circle');
    await owner.getByRole('button', { name: 'Invite people' }).first().click();
    const invite = owner.getByRole('dialog', { name: 'Invite your people' });
    await invite.getByRole('button', { name: 'Generate invite link' }).click();
    const link = await invite.getByRole('textbox', { name: 'INVITE LINK' }).inputValue();
    expect(new URL(link).pathname).toMatch(/^\/invite\/[a-f0-9]{64}$/);
    const channelURL = owner.url();

    await guest.goto(new URL(link).pathname);
    await expect(guest.getByRole('heading', { name: 'Cove Test Circle' })).toBeVisible();
    await guest.getByRole('link', { name: 'Create an account' }).click();
    await register(guest, 'e2e_jamie', 'Jamie Chen', 'invite');
    await expect(guest.getByRole('button', { name: 'Join community' })).toBeVisible();
    await guest.getByRole('button', { name: 'Join community' }).click();
    await expect(guest).toHaveURL(/\/app\/servers\/[a-f0-9-]+\/channels\/[a-f0-9-]+/);
    await expect(guest.getByRole('heading', { name: 'welcome', exact: true })).toBeVisible();

    // Owner and guest have distinct browser sessions; no refresh/poll on the guest.
    await invite.getByRole('button', { name: 'Close dialog' }).click();
    await owner.goto(channelURL);
    const live = 'Hello Jamie, this arrived in real time';
    await owner.getByPlaceholder('Message #channel...').fill(live);
    await owner.getByRole('button', { name: 'Send message' }).click();
    await expect(guest.getByRole('log', { name: 'Messages' }).getByText(live, { exact: true })).toBeVisible();

    await guest.setViewportSize({ width: 390, height: 844 });
    await guest.getByRole('button', { name: 'Open navigation' }).click();
    await guest.getByRole('link', { name: 'general', exact: true }).last().click();
    await expect(guest.getByRole('heading', { name: 'general', exact: true })).toBeVisible();
  } finally { await Promise.allSettled([ownerContext.close(), guestContext.close()]); }
});

test('friend request becomes a two-way direct conversation', async ({ browser }) => {
  const contextA = await browser.newContext(); const contextB = await browser.newContext();
  try {
    const alex = await contextA.newPage(); const jordan = await contextB.newPage();
    await alex.goto('/register'); await register(alex, 'e2e_alexfriend', 'Alex Friend');
    await jordan.goto('/register'); await register(jordan, 'e2e_jordan', 'Jordan Quinn');
    await alex.getByRole('button', { name: 'Add friend', exact: true }).click();
    const dialog = alex.getByRole('dialog', { name: 'Find a friend' });
    await dialog.getByPlaceholder('@username').fill('e2e_jordan');
    await dialog.getByRole('button', { name: 'Send friend request' }).click();
    await expect(jordan.getByRole('button', { name: /Pending/ })).toBeVisible();
    await jordan.getByRole('button', { name: /Pending/ }).click();
    await jordan.getByRole('button', { name: 'Accept Alex Friend' }).click();
    await expect(alex.getByRole('button', { name: 'Message Jordan Quinn' })).toBeVisible();
    await alex.getByRole('button', { name: 'Message Jordan Quinn' }).click();
    await expect(alex).toHaveURL(/\/app\/dms\/[a-f0-9-]+/);
    await jordan.getByRole('link', { name: /Alex Friend/ }).click();
    await expect(jordan).toHaveURL(/\/app\/dms\/[a-f0-9-]+/);
    const text = 'Friends can have a private chat';
    await alex.getByPlaceholder('Message your friend...').fill(text);
    await alex.getByRole('button', { name: 'Send message' }).click();
    await expect(jordan.getByRole('log', { name: 'Messages' }).getByText(text, { exact: true })).toBeVisible();
  } finally { await Promise.allSettled([contextA.close(), contextB.close()]); }
});
