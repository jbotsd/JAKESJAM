import { defineConfig, devices } from "@playwright/test";

const BASE_URL =
  process.env.E2E_BASE_URL ?? "https://jakesjam.vercel.app";

export default defineConfig({
  testDir: "./tests/e2e",
  outputDir: "./tests/e2e/.artifacts",
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: 1,
  timeout: 60_000,
  reporter: process.env.CI ? "list" : [["list"], ["html", { open: "never", outputFolder: "tests/e2e/.report" }]],
  use: {
    baseURL: BASE_URL,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    // Capture WebM video of every test session. Set to "off" once the
    // collision investigation is done — videos add 1-3 MB per test and
    // bloat the artifacts dir.
    video: "on",
    headless: true,
    viewport: { width: 1280, height: 800 },
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
});
