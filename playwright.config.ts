import { defineConfig, devices } from "@playwright/test";

/**
 * End-to-end browser tests.
 *
 * `testDir` is `./e2e`, NOT `./tests` -- `tests/` is the pytest suite (69
 * files). The generated scaffold pointed here at `./tests` and dropped an
 * `example.spec.ts` in among the Python tests; that was corrected rather than
 * left to confuse the next reader.
 *
 * These run against a DEPLOYED origin (production by default) rather than a
 * dev server, because their whole point is to check what is actually served:
 * the Vitest suite in `frontend/` already covers the same components in jsdom,
 * and a jsdom pass has never once told us whether the built bundle on
 * app.malathi.io behaves. Override with E2E_BASE_URL to point at local dev.
 *
 *   npx playwright test                                   # against production
 *   E2E_BASE_URL=http://localhost:5173 npx playwright test  # against local dev
 *
 * CI runs the same suite on every push (the `e2e` job in
 * .github/workflows/ci.yml) against the built bundle on :4173 and a backend
 * on :8000, seeded by app.db.seed + scripts/e2e_seed.py -- so it checks the
 * commit, not what is already deployed.
 *
 * Nothing in `e2e/` submits a form or writes data -- see the note at the top
 * of public-vacancy-request.spec.ts.
 */
export default defineConfig({
  testDir: "./e2e",
  // Authenticated specs hand a rotating refresh token from file to file
  // (see e2e/auth.ts); setup clears any stale one, teardown revokes the
  // session. That hand-off is only sound with a single worker, and the
  // whole suite is short enough that parallelism buys nothing worth the
  // token races it would introduce.
  globalSetup: "./e2e/global-setup.ts",
  globalTeardown: "./e2e/global-teardown.ts",
  fullyParallel: false,
  workers: 1,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  reporter: [["list"], ["html", { open: "never" }]],
  use: {
    baseURL: process.env.E2E_BASE_URL ?? "https://app.malathi.io",
    trace: "on-first-retry",
    // Production is a remote host over TLS; the scaffold's defaults assume
    // localhost and time out on a cold container.
    actionTimeout: 15_000,
    navigationTimeout: 30_000,
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
});
