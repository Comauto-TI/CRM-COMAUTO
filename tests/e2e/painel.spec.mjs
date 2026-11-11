import { expect, test } from "@playwright/test";
import { randomUUID } from "node:crypto";

test("recepção assume, responde e devolve uma conversa e consulta o financeiro", async ({ page }) => {
  await page.goto("/login");
  await page.getByLabel("E-mail", { exact: true }).fill(process.env.COMAUTO_E2E_EMAIL);
  await page.getByLabel("Senha", { exact: true }).fill(process.env.COMAUTO_E2E_SENHA);
  await page.getByRole("button", { name: "Entrar no painel", exact: true }).click();
  await expect(page).toHaveURL(/\/painel(?:\/|$)/);

  const alerta = page.locator(".toast-pilha .toast[role='button']").filter({ hasText: /Cliente Demo \d{2} aguardando atendimento/ }).first();
  await expect(alerta).toBeVisible({ timeout: 15_000 });
  await alerta.click();

  await expect(page).toHaveURL(/\/painel\/conversas\?[^#]*c=/);
  await expect(page.getByRole("heading", { name: "Atendimento", exact: true })).toBeVisible();
  const atendimento = page.locator(".wa-chat");
  await expect(atendimento.getByText(/^Aguardando na fila/)).toBeVisible();
  await atendimento.getByRole("button", { name: "Assumir atendimento", exact: true }).click();
  await expect(atendimento.getByText(/^Em atendimento com você/)).toBeVisible();

  const resposta = `Resposta automática de teste ${randomUUID()}`;
  await atendimento.getByPlaceholder("Digite uma mensagem (sai pelo número oficial)").fill(resposta);
  await atendimento.getByRole("button", { name: "Enviar", exact: true }).click();
  await expect(atendimento.getByText(resposta, { exact: true })).toBeVisible();

  await atendimento.getByRole("button", { name: "Devolver ao bot", exact: true }).click();
  await expect(atendimento.getByText(/^Assistente virtual atendendo/)).toBeVisible();

  const gestao = page.getByRole("button", { name: "Gestão", exact: true });
  if (await gestao.getAttribute("aria-expanded") !== "true") await gestao.click();
  await page.getByRole("link", { name: "Financeiro", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Financeiro", exact: true })).toBeVisible();
  await expect(page.getByRole("img", { name: "Gráfico de custo diário empilhado por categoria" })).toBeVisible();
});

