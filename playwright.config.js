// @ts-check
const { defineConfig, devices } = require('@playwright/test');

const baseURL = process.env.BASE_URL || 'https://race-arena-d1bc8.web.app';

module.exports = defineConfig({
  testDir: './tests/e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: 1,
  reporter: 'list',
  use: {
    baseURL,
    trace: 'on-first-retry',
    ...devices['Desktop Chrome'],
  },
  timeout: 60_000,
});
