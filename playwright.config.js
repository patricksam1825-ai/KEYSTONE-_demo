import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests-e2e',
  testMatch: '**/*.e2e.mjs',
  fullyParallel: false,
  workers: 1,
  timeout: 45_000,
  reporter: 'list',
  use: {
    baseURL: 'http://127.0.0.1:4300',
    browserName: 'chromium',
    headless: true
  }
});
