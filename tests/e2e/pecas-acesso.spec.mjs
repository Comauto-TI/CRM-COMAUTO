import { expect, test } from "@playwright/test";

/**
 * Preparação de QA: não executada contra um painel nesta entrega.
 * Usar um servidor local já iniciado pelo coordenador, com banco/conta e fixtures fictícias.
 * Guardar somente em arquivo ignorado, por exemplo tests/e2e/.env.pecas.local:
 * COMAUTO_E2E_PECAS_EMAIL / COMAUTO_E2E_PECAS_SENHA
 * COMAUTO_E2E_PECAS_COTACAO_PROPRIA (aberta, atribuída a este login, com conversa válida e canal disponível ou próprio)
 * COMAUTO_E2E_PECAS_COTACAO_COLEGA (aberta, atribuída a outro Peças na mesma unidade)
 * COMAUTO_E2E_PECAS_COTACAO_OUTRA_UNIDADE (aberta, em unidade não autorizada)
 * As estrangeiras precisam ter detalhe/conversa válidos, com controle positivo na sessão de seus donos.
 * Depois desse controle, definir o respectivo COMAUTO_E2E_PECAS_COTACAO_*_VALIDADA_BROWSER=1.
 * Os três IDs devem ser distintos. Não inventar IDs para preencher requisitos ausentes.
 *
 * Descoberta sem carregar credenciais, iniciar servidor ou abrir navegador:
 * node node_modules/@playwright/test/cli.js test --config tests/e2e/playwright.pecas-readonly.config.mjs --list
 * Execução futura, somente após liberação do ambiente pelo coordenador:
 * node --env-file=tests/e2e/.env.pecas.local node_modules/@playwright/test/cli.js test --config tests/e2e/playwright.pecas-readonly.config.mjs
 * Cada teste usa o BrowserContext descartável padrão; não persiste nem compartilha storageState.
 */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const bloqueios = new WeakMap();

function exigirCotacao(nome, exigirControleBrowser = false) {
  const id = process.env[nome];
  test.skip(!id, `Requisito ausente: ${nome}.`);
  expect(typeof id === "string" && id.length === 36 && UUID.test(id), `Requisito inválido: ${nome}.`).toBe(true);
  if (exigirControleBrowser) {
    const controle = `${nome}_VALIDADA_BROWSER`;
    test.skip(process.env[controle] !== "1", `Requisito ausente: ${controle}=1 após controle positivo na sessão do dono.`);
  }
  return id.toLowerCase();
}

test.beforeEach(async ({ page, baseURL }) => {
  const email = process.env.COMAUTO_E2E_PECAS_EMAIL;
  const senha = process.env.COMAUTO_E2E_PECAS_SENHA;
  test.skip(!email, "Requisito ausente: COMAUTO_E2E_PECAS_EMAIL.");
  test.skip(!senha, "Requisito ausente: COMAUTO_E2E_PECAS_SENHA.");

  const tentativas = [];
  bloqueios.set(page, tentativas);
  const origem = new URL(baseURL).origin;
  let loginEmAndamento = false;
  await page.route("**/*", async route => {
    const request = route.request();
    const url = new URL(request.url());
    if (url.origin !== origem) return route.abort();
    // Este GET legado zera não lidas. Nunca deixar o navegador chamá-lo, inclusive em regressão de menu/perfil.
    if (/^\/api\/painel\/conversa\//.test(url.pathname)) {
      tentativas.push("GET de contador geral");
      return route.abort();
    }
    if (["GET", "HEAD"].includes(request.method())) return route.continue();
    if (loginEmAndamento && request.method() === "POST" && url.pathname === "/login") return route.continue();
    tentativas.push(`${request.method()} ${url.pathname}`);
    return route.abort();
  });

  await page.goto("/login");
  await test.step("Autenticar somente a conta local de Peças", async () => {
    // Sem traces/screenshots e sem propagar eventuais logs dos valores usados no preenchimento.
    try {
      await page.getByLabel("E-mail", { exact: true }).fill(email);
      await page.getByLabel("Senha", { exact: true }).fill(senha);
    } catch {
      throw new Error("Não foi possível preencher o formulário da conta local de Peças.");
    }
    loginEmAndamento = true;
    try {
      await page.getByRole("button", { name: "Entrar no painel", exact: true }).click();
      await expect(page).toHaveURL(url => url.pathname === "/painel");
    } finally {
      loginEmAndamento = false;
    }
  });
  // Impede usar por engano a conta administrativa do smoke antigo antes das provas de acesso direto.
  await expect(page.locator('.lateral-usuario [title="Peças · Peças"]')).toBeVisible();
});

test.afterEach(async ({ page }) => {
  expect(bloqueios.get(page) ?? [], "A rodada não pode tentar ações de escrita nem leitura de contador geral.").toEqual([]);
});

test("Peças entra na visão geral com o menu do próprio perfil", async ({ page }) => {
  await expect(page.getByRole("heading", { name: /^Olá,/ })).toBeVisible();
  const menu = page.getByRole("navigation", { name: "Menu principal" });
  await expect(menu.getByRole("link", { name: "Visão geral", exact: true })).toBeVisible();
  await expect(menu.getByRole("link", { name: "Cotações", exact: true })).toBeVisible();
  await expect(menu.getByRole("link", { name: "Quadro de vendas", exact: true })).toHaveCount(0);
  await expect(menu.getByRole("link", { name: "Atendimento WhatsApp", exact: true })).toHaveCount(0);
});

test("Peças lê o quadro e abre somente a conversa e o detalhe da cotação própria", async ({ page }) => {
  const propria = exigirCotacao("COMAUTO_E2E_PECAS_COTACAO_PROPRIA");
  await page.goto("/painel/pecas");
  await expect(page.getByRole("heading", { name: "Peças", exact: true })).toBeVisible();
  await expect(page.getByRole("region", { name: "Etapa Em cotação", exact: true })).toBeVisible();
  const cartao = page.locator(`a.kanban-cartao[href="/painel/pecas?cotacao=${propria}"]`);
  await expect(cartao).toHaveCount(1);
  const respostaConversa = page.waitForResponse(response => {
    const url = new URL(response.url());
    return response.request().method() === "GET" && url.pathname === `/api/painel/pecas/${propria}/conversa`;
  });
  await cartao.click();
  await expect(page).toHaveURL(url => url.pathname === "/painel/pecas" && url.searchParams.get("cotacao") === propria);
  const resposta = await respostaConversa;
  expect(resposta.status()).toBe(200);
  const corpo = await resposta.json();
  expect(corpo.ok).toBe(true);
  expect(corpo.cotacaoId).toBe(propria);
  expect(["livre", "minha"]).toContain(corpo.estado);
  expect(corpo.podeAssumir).toBe(corpo.estado === "livre");
  const painel = page.getByRole("complementary", { name: "Atendimento da cotação de Peças" });
  await expect(painel).toBeVisible();
  await expect(painel.getByRole("log", { name: "Mensagens do atendimento" })).toBeVisible();
  await painel.getByRole("link", { name: "Ver detalhes da cotação", exact: true }).click();
  await expect(page).toHaveURL(url => url.pathname === `/painel/pecas/${propria}`);
  await expect(page.getByRole("heading", { name: "Cotação de peças", exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Solicitação", exact: true })).toBeVisible();
  // Nenhuma criação, claim, envio, arraste, edição, devolução ou marcação é realizada.
});

for (const [caso, requisito] of [
  ["carteira de colega", "COMAUTO_E2E_PECAS_COTACAO_COLEGA"],
  ["unidade não autorizada", "COMAUTO_E2E_PECAS_COTACAO_OUTRA_UNIDADE"],
]) {
  test(`Peças não lê cotação de ${caso} por cartão, URL ou API`, async ({ page }) => {
    const id = exigirCotacao(requisito, true);
    await page.goto("/painel/pecas");
    await expect(page.locator(`a.kanban-cartao[href="/painel/pecas?cotacao=${id}"]`)).toHaveCount(0);
    const respostaPagina = await page.goto(`/painel/pecas/${id}`);
    expect(respostaPagina?.status()).toBe(404);
    const respostaApi = await page.request.get(`/api/painel/pecas/${id}/conversa`, { maxRedirects: 0 });
    expect(respostaApi.status()).toBe(404);
    const corpo = await respostaApi.json();
    expect(corpo.ok).toBe(false);
    expect(corpo).not.toHaveProperty("mensagens");
    expect(corpo).not.toHaveProperty("clienteNome");
  });
}

test("Peças recebe recusa em Vendas e Atendimento geral por URL direta", async ({ page }) => {
  for (const rota of ["/painel/vendas", "/painel/conversas"]) {
    await page.goto(rota);
    await expect(page).toHaveURL(url => url.pathname === "/painel" && url.searchParams.get("erro") === "sem_permissao");
    await expect(page.getByText("Seu perfil não tem acesso a essa área.", { exact: true })).toBeVisible();
  }
});

test("Peças recebe recusa nas APIs gerais sem abrir um contador real", async ({ page }) => {
  // APIRequestContext usa a sessão deste BrowserContext. Ambas as rotas só leem; nenhum contador é aberto.
  for (const rota of ["/api/painel/inbox", "/api/painel/fila"]) {
    const resposta = await page.request.get(rota, { maxRedirects: 0 });
    expect(resposta.status()).toBe(401);
    expect(await resposta.text()).toBe("unauthorized");
  }
});
