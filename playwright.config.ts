import { defineConfig } from '@playwright/test';
// E2E_BASE: origin+path of a running stack (default: isolated stack from scripts/dev-iso.sh 1).
export default defineConfig({
  testDir: 'tests/e2e',
  // unique per run so concurrent agents never wipe each other's artifacts
  outputDir: process.env.PW_OUT ?? `/tmp/pw-out-${process.pid}`,
  timeout: 45_000,
  expect: { timeout: 8_000 },
  fullyParallel: false,
  workers: 1,
  reporter: [['list']],
  use: {
    baseURL: process.env.E2E_BASE ?? 'http://localhost:5201/app/',
    viewport: { width: 440, height: 956 },
    geolocation: { latitude: 59.343, longitude: 18.055 },
    permissions: ['geolocation'],
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
});
