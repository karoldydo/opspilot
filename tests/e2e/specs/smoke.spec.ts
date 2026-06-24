import { expect, test } from '@playwright/test';

// the chromium project loads storageState from auth.setup.ts, so this test is already authenticated.
// it proves the full wiring: both servers up, proxy /api -> :3000, and the session cookie working.
test('authenticated overview renders without redirect to /login', async ({ page }) => {
  await page.goto('/');

  // the overview heading is present regardless of fleet data state, so it is the stable anchor
  await expect(page.getByRole('heading', { name: 'overview' })).toBeVisible();

  // the auth guard would have bounced an unauthenticated visit to /login; staying on / proves the cookie
  await expect(page).toHaveURL(/\/$/);
});
