import { expect, test } from "@playwright/test";
import { randomUUID } from "node:crypto";

test("recepção assume, responde e devolve uma conversa e consulta o financeiro", async ({ page }) => {
  await page.goto("/login");
  await page.getByLabel("E-mail", { exact: true }).fill(process.env.COMAUTO_E2E_EMAIL);
  await page.getByLabel("Senha", { exact: true }).fill(process.env.COMAUTO_E2E_SENHA);
  await page.getByRole("button", { name: "Entrar", exact: true }).click();
  await expect(page).toHaveURL(/\/painel(?:\/|$)/);

  const alerta = page.locator(".toast-pilha").getByRole("button").filter({ hasText: /Cliente Demo \d{2}/ }).first();
  await expect(alerta).toBeVisible({ timeout: 15_000 });
  await alerta.click();

  const atendimento = page.getByRole("dialog", { name: "Atendimento" });
  await expect(atendimento.getByText("Aguardando na fila", { exact: true })).toBeVisible();
  await atendimento.getByRole("button", { name: "Assumir", exact: true }).click();
  await expect(atendimento.getByText(/Em atendimento com/)).toBeVisible();

  const resposta = `Resposta automática de teste ${randomUUID()}`;
  await atendimento.getByPlaceholder(/Escreva a resposta/).fill(resposta);
  await atendimento.getByRole("button", { name: "Enviar", exact: true }).click();
  await expect(atendimento.getByText(resposta, { exact: true })).toBeVisible();

  await atendimento.getByRole("button", { name: "Devolver ao bot", exact: true }).click();
  await expect(atendimento.getByText("Assistente virtual atendendo", { exact: true })).toBeVisible();
  await atendimento.getByRole("button", { name: "Fechar", exact: true }).click();

  await page.getByRole("link", { name: "Financeiro", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Financeiro", exact: true })).toBeVisible();
  await expect(page.getByRole("img", { name: "Gráfico de custo diário empilhado por categoria" })).toBeVisible();
});

