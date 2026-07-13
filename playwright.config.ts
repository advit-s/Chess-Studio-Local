import path from 'node:path';
import { defineConfig, devices } from '@playwright/test';

const customExecutable = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH;
const useInstalledChrome = process.env.PLAYWRIGHT_USE_CHROME === '1';
const baseURL = process.env.PLAYWRIGHT_BASE_URL ?? 'http://127.0.0.1:4173';
const serverCommand = process.env.PLAYWRIGHT_SERVER_COMMAND ?? 'npm run preview -- --port 4173 --strictPort';

export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 45_000,
  expect: { timeout: 12_000 },
  outputDir: 'test-results',
  reporter: [['list']],
  use: {
    ...devices['Desktop Chrome'],
    baseURL,
    channel: useInstalledChrome ? 'chrome' : undefined,
    trace: customExecutable ? 'off' : 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'off',
    launchOptions: customExecutable ? {
      executablePath: path.resolve(customExecutable),
      args: [
        '--ash-no-nudges',
        '--disable-domain-reliability',
        '--disable-print-preview',
        '--disk-cache-size=33554432',
        '--no-default-browser-check',
        '--no-pings',
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-gpu-sandbox',
        '--single-process',
        '--font-render-hinting=none',
        '--disable-features=AudioServiceOutOfProcess,IsolateOrigins,site-per-process',
        '--no-zygote',
        '--disable-site-isolation-trials',
        '--disable-web-security',
        '--enable-features=SharedArrayBuffer',
        '--ignore-gpu-blocklist',
        '--in-process-gpu',
        '--use-gl=angle',
        '--use-angle=swiftshader',
        '--enable-unsafe-swiftshader',
        '--allow-running-insecure-content',
        "--headless='shell'",
      ],
    } : undefined,
  },
  webServer: {
    command: serverCommand,
    url: baseURL,
    reuseExistingServer: false,
    timeout: 30_000,
  },
});
