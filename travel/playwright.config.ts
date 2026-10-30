import { defineConfig } from '@playwright/test';

// End-to-end tests of Cacao Travel against the local stack: the dev server on 4322, the regtest BTCPay
// wallet on 8088 and Cacao Media on 4321 (for the reader token). Run with `npm run test:e2e` from travel/.
export default defineConfig({
  testDir: './tests/e2e',
  // Lightning payments take a few seconds to settle, so each test gets room for one payment.
  timeout: 90_000,
  workers: 1,
  fullyParallel: false,
  reporter: 'list',
  use: {
    baseURL: 'http://localhost:4322',
    contextOptions: { reducedMotion: 'reduce' },
  },
  // TRAVEL_SIN_SERVIDOR=1 runs against servers already started by hand (for example the pause server on 4332).
  webServer: process.env.TRAVEL_SIN_SERVIDOR
    ? undefined
    : { command: 'npm run dev', url: 'http://localhost:4322', reuseExistingServer: true, timeout: 120_000 },
});
