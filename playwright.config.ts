import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests',
  testMatch: '**/*.spec.ts',
  fullyParallel: true,
  workers: 2,
  use: {
    baseURL: 'http://127.0.0.1:4187',
    viewport: { width: 1440, height: 1000 },
    trace: 'retain-on-failure',
  },
  projects: [
    { name: 'chromium', testIgnore: '**/webkit-keyboard.spec.ts', use: { browserName: 'chromium', channel: process.env.PLAYWRIGHT_CHANNEL || undefined } },
    ...(process.env.PLAYWRIGHT_ALL_DESKTOP === '1' ? [
      { name: 'firefox' as const, testIgnore: '**/webkit-keyboard.spec.ts', use: { browserName: 'firefox' as const } },
      { name: 'webkit-keyboard' as const, testMatch: '**/webkit-keyboard.spec.ts', use: { browserName: 'webkit' as const } },
      ...(process.env.PLAYWRIGHT_WEBKIT_POINTER === '1' ? [
        { name: 'webkit-pointer' as const, testIgnore: '**/webkit-keyboard.spec.ts', use: { browserName: 'webkit' as const } },
      ] : []),
    ] : []),
  ],
  webServer: {
    command: 'node server/index.mjs',
    url: 'http://127.0.0.1:4187',
    env: { PORT: '4187', REPFORM_DB: ':memory:', CHATGPT_API_KEY: '' },
  },
});
