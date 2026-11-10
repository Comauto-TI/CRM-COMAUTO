import { defineConfig } from "@playwright/test";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";

const raiz = fileURLToPath(new URL("../../", import.meta.url));
const envLocal = fileURLToPath(new URL("../../.env.local", import.meta.url));
if (existsSync(envLocal)) process.loadEnvFile(envLocal);

const urlSupabase = new URL(process.env.NEXT_PUBLIC_SUPABASE_URL ?? "http://invalid.test");
if (!["localhost", "127.0.0.1", "[::1]"].includes(urlSupabase.hostname)) {
  throw new Error("Smoke do painel requer NEXT_PUBLIC_SUPABASE_URL apontando para o Supabase local.");
}
if (!process.env.COMAUTO_E2E_EMAIL || !process.env.COMAUTO_E2E_SENHA) {
  throw new Error("Defina COMAUTO_E2E_EMAIL e COMAUTO_E2E_SENHA para o administrador de teste local.");
}

const baseURL = "http://127.0.0.1:3300";
const preload = new URL("./graph-falso.mjs", import.meta.url).href;

export default defineConfig({
  testDir: ".",
  testMatch: "painel.spec.mjs",
  timeout: 60_000,
  workers: 1,
  use: { baseURL },
  webServer: {
    command: "npm run dev -- --hostname 127.0.0.1 --port 3300",
    cwd: raiz,
    url: baseURL + "/login",
    timeout: 120_000,
    reuseExistingServer: false,
    env: {
      APP_URL: baseURL,
      NODE_OPTIONS: `${process.env.NODE_OPTIONS ?? ""} --import=${preload}`.trim(),
      WHATSAPP_TOKEN: "fixture-local-sem-credencial-real",
      ANTHROPIC_API_KEY: "fixture-local-sem-credencial-real",
    },
  },
});

