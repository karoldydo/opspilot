import { defineConfig, devices } from '@playwright/test';
import { resolve } from 'node:path';

// run both web servers from the workspace root (not this config's dir, which is playwright's
// default cwd) so nx-relative paths resolve exactly like `npm run start:*` does in dev — in
// particular the api's `./data/...` db path lands at repo-root `data/`, beside the dev db.
const rootDir = resolve(__dirname, '../..');

// isolated test database so the dev `opspilot.db` is never touched
const DATABASE_PATH = './data/opspilot.e2e.db';

// where the authenticated session cookie (better auth) is persisted between projects.
// absolute (anchored to this config's dir) so it resolves the same whatever the runner cwd is —
// a bare relative string would be re-rooted at the config dir and nest as tests/e2e/tests/e2e/.
const storageState = resolve(__dirname, '.auth/user.json');

export default defineConfig({
  forbidOnly: !!process.env.CI,
  fullyParallel: true,
  projects: [
    // signs up a unique user and writes storageState; runs before the browser project
    { name: 'setup', testMatch: /.*\.setup\.ts/ },
    {
      dependencies: ['setup'],
      name: 'chromium',
      use: { ...devices['Desktop Chrome'], storageState },
    },
  ],
  reporter: [['html', { open: 'never' }], ['list']],
  retries: process.env.CI ? 2 : 0,
  testDir: './specs',
  use: {
    baseURL: 'http://localhost:4200',
    screenshot: 'only-on-failure',
    trace: 'on-first-retry',
    video: 'retain-on-failure',
  },
  // nx starts both apps; reuse a running dev server locally, always boot fresh in ci
  webServer: [
    {
      // env is inlined into the command (not playwright's `env` option) because nx forks the
      // built api into its own node process and only the inline shell assignment reaches that
      // child — passing DATABASE_PATH via `env` lands on the nx cli but not the served app, which
      // would silently fall back to the dev db (`./data/opspilot.db`) and break isolation.
      command: `DATABASE_PATH=${DATABASE_PATH} NODE_ENV=test PORT=3000 npx nx run api:serve`,
      cwd: rootDir,
      reuseExistingServer: !process.env.CI,
      timeout: 120_000,
      url: 'http://localhost:3000/api/health',
    },
    {
      command: 'npx nx run web:serve',
      cwd: rootDir,
      reuseExistingServer: !process.env.CI,
      timeout: 120_000,
      url: 'http://localhost:4200',
    },
  ],
});
