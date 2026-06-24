import { defineConfig, devices } from '@playwright/test';

// isolated test database so the dev `opspilot.db` is never touched
const DATABASE_PATH = './data/opspilot.e2e.db';

// where the authenticated session cookie (better auth) is persisted between projects
const storageState = 'tests/e2e/.auth/user.json';

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
      command: 'npx nx run api:serve',
      env: { DATABASE_PATH, NODE_ENV: 'test', PORT: '3000' },
      reuseExistingServer: !process.env.CI,
      timeout: 120_000,
      url: 'http://localhost:3000/api/health',
    },
    {
      command: 'npx nx run web:serve',
      reuseExistingServer: !process.env.CI,
      timeout: 120_000,
      url: 'http://localhost:4200',
    },
  ],
});
