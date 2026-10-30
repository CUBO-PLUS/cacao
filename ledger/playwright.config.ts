import { defineConfig } from "@playwright/test";

// End-to-end tests run against the dev server already up on port 4325 (`npm run dev`) with the local stack:
// local Supabase, the Clerk development instance and the regtest BTCPay. They share one database, so they run
// one at a time.
//
// Two projects: "publico" needs no account. "dueno" first signs in the two test accounts (sesion.setup.ts) and
// then runs the owner pages with those sessions.
export default defineConfig({
  testDir: "./tests/e2e",
  timeout: 120_000,
  expect: { timeout: 20_000 },
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [["list"]],
  projects: [
    { name: "sesion", testMatch: /sesion\.setup\.ts/ },
    { name: "publico", testMatch: /ledger-publico\.spec\.ts/ },
    {
      name: "dueno",
      testMatch: /ledger-dueno\.spec\.ts/,
      dependencies: ["sesion"],
    },
  ],
  use: {
    baseURL: process.env.LEDGER_URL ?? "http://localhost:4325",
    // Phone first: the tablero is read on a phone.
    viewport: { width: 375, height: 800 },
    locale: "es-SV",
    timezoneId: "America/El_Salvador",
    trace: "retain-on-failure",
  },
  outputDir: "./.qa/e2e-resultados",
});
