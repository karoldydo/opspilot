import { expect, test as setup } from '@playwright/test';
import { resolve } from 'node:path';

// where the authenticated session cookie (better auth) is persisted for the chromium project.
// anchored to this spec's dir (specs/ -> ../.auth) so it matches the absolute path the config
// hands the chromium project regardless of the runner cwd.
const storageState = resolve(__dirname, '..', '.auth', 'user.json');

// open signup means we provision a fresh user per run instead of relying on a seeded one;
// the timestamp suffix keeps parallel runs and re-runs from colliding on the unique email.
const email = `e2e+${Date.now()}@opspilot.local`;
// fixed fallback stays >= 8 chars to satisfy the better-auth password bounds (min 8, max 128)
const password = process.env.E2E_USER_PASSWORD ?? 'e2e-passw0rd';

setup('authenticate via better-auth signup', async ({ page }) => {
  // sign up through the proxy (/api -> :3000); the response sets the http-only session cookie
  const response = await page.request.post('/api/auth/sign-up/email', {
    data: { email, name: 'e2e user', password },
  });
  // surface the server body in the failure message — a bare ok() hides e.g. a 422 password-policy error
  expect(response.ok(), await response.text()).toBeTruthy();

  // prove the cookie really authenticates before we trust the stored state
  const session = await page.request.get('/api/auth/get-session');
  expect(session.ok(), await session.text()).toBeTruthy();
  const body = await session.json();
  expect(body?.user?.email).toBe(email);

  // persist the session cookie so the chromium project starts already authenticated
  await page.context().storageState({ path: storageState });
});
