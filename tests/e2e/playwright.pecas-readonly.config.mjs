import { defineConfig } from "@playwright/test";

// Somente o coordenador inicia o servidor. Esta configuração não lê .env nem sobe Next/Supabase.
const base = new URL(process.env.COMAUTO_E2E_BASE_URL ?? "http://127.0.0.1:3300");
if (base.protocol !== "http:" || !["localhost", "127.0.0.1", "[::1]"].includes(base.hostname) ||
  base.username || base.password || base.pathname !== "/" || base.search || base.hash) {
  throw new Error("A rodada de Peças exige a origem HTTP local do servidor coordenado.");
}

export default defineConfig({
  testDir: ".",
  testMatch: "pecas-acesso.spec.mjs",
  timeout: 45_000,
  expect: { timeout: 10_000 },
  workers: 1,
  retries: 0,
  fullyParallel: false,
  reporter: [["line"]],
  outputDir: "../../test-results/pecas-readonly",
  use: {
    baseURL: base.origin,
    browserName: "chromium",
    viewport: { width: 1440, height: 1000 },
    serviceWorkers: "block",
    trace: "off",
    screenshot: "off",
    video: "off",
    launchOptions: process.env.COMAUTO_E2E_CHROMIUM_EXECUTABLE
      ? { executablePath: process.env.COMAUTO_E2E_CHROMIUM_EXECUTABLE } : {},
  },
});
