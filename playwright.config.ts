import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir: './tests',
  testMatch: '*.e2e.ts',
  fullyParallel: false,
  workers: 1,
  timeout: 30000,
  use: {
    baseURL: 'http://localhost:5173',
    channel: 'chrome',
    headless: true,
    viewport: { width: 1440, height: 960 },
    screenshot: 'only-on-failure',
  },
  // The game, and the room server the online tests talk to.
  webServer: [
    {
      command: 'npm run dev -- --port 5173',
      url: 'http://localhost:5173',
      reuseExistingServer: true,
    },
    {
      command: 'npm run rooms',
      url: 'http://localhost:8787/health',
      reuseExistingServer: true,
      timeout: 120000,
    },
  ],
  reporter: 'list',
});
