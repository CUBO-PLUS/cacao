import { defineConfig } from '@playwright/test';

// Two sites, two dev servers. `npm test` runs both projects.
export default defineConfig({
  testDir: './tests',
  projects: [
    { name: 'media', testMatch: /(gate|media-btcpay)\.spec\.ts/, use: { baseURL: 'http://localhost:4321' } },
    { name: 'travel', testMatch: /travel\.spec\.ts/, use: { baseURL: 'http://localhost:4322' } },
  ],
  webServer: [
    { command: 'npm run dev', url: 'http://localhost:4321', reuseExistingServer: true, timeout: 120_000 },
    { command: 'npm --prefix travel run dev', url: 'http://localhost:4322', reuseExistingServer: true, timeout: 120_000 },
  ],
});
