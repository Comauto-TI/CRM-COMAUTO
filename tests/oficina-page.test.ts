import { createElement, type ComponentProps } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Usuario } from "@/lib/auth";
import type { ConfigMap } from "@/lib/config";
import type { AtendimentoOficina, ResultadoFilaOficina } from "@/modulos/oficina/atendimentos";
import OficinaPage from "@/app/painel/oficina/page";
import QuadroOficina from "@/app/painel/oficina/QuadroOficina";

const f = vi.hoisted(() => ({
  exigirAcesso: vi.fn<typeof import("@/lib/auth").exigirAcesso>(),
  getConfig: vi.fn<typeof import("@/lib/config").getConfig>(),
  listarAtendimentos: vi.fn<typeof import("@/modulos/oficina/atendimentos").listarAtendimentos>(),
  criarAtendimento: vi.fn<typeof import("@/app/painel/oficina/actions").criarAtendimento>(),
  assumirAtendimento: vi.fn<typeof import("@/app/painel/oficina/actions").assumirAtendimento>(),
}));

vi.mock("@/lib/auth", () => ({ exigirAcesso: f.exigirAcesso }));
vi.mock("@/lib/config", () => ({ getConfig: f.getConfig }));
vi.mock("@/modulos/oficina/atendimentos", () => ({ listarAtendimentos: f.listarAtendimentos }));
vi.mock("@/app/painel/oficina/actions", () => ({ criarAtendimento: f.criarAtendimento, assumirAtendimento: f.assumirAtendimento }));
vi.mock("next/link", () => ({
  default: ({ href, children, ...props }: ComponentProps<"a">) => createElement("a", { ...props, href }, children),
}));
// Fora do runtime Next, useFormStatus não reproduz o envio de uma Server Action.
// O botão é a única parte visual substituída; página, quadro, parser e formatação são reais.
vi.mock("@/app/painel/oficina/BotaoOficina", () => ({
  default: ({ texto }: { texto: string; aguardando: string }) => createElement("button", { type: "submit" }, texto),
}));

// Todos os dados são fictícios e locais ao teste. SSR com fronteiras mockadas não comprova login ou E2E.
const ID = "bf000000-0000-4000-8000-000000000001";
const OUTRO_ID = "bf000000-0000-4000-8000-000000000002";
const EM_TRIAGEM_ID = "bf000000-0000-4000-8000-000000000003";
const INSTANTE = "2026-11-12T17:45:59.123456Z";
const USUARIO: Usuario = {
  id: "bf100000-0000-4000-8000-000000000001", nome: "Consultora fictícia", email: "oficina@example.invalid",
  papel: "consultor_tecnico", setor: "oficina", unidade: "comauto", unidades: ["comauto", "santaluzia"],
};
const CONFIG: ConfigMap = {
  empresa: { nome: "Empresa fictícia", endereco: "", telefone_humano: "", site: "" },
  fuso_offset: "-04:00", cambio_usd_brl: 0,
  claude_preco: { modelo: "ficticio", input: 0, output: 0, cache_read: 0, cache_write: 0 },
  agenda: { antecedencia_min_horas: 2, janela_dias: 30, passo_min: 30, intervalo_min: 0, max_opcoes: 6 },
  horario_envio: { inicio: "08:00", fim: "20:00", dias: [1, 2, 3, 4, 5] },
  followup: { pos_servico_dias: 2, revisao_aviso_dias: 3, lead_horas: 20, nao_compareceu_horas: 3, max_tentativas: 1 },
  seguranca: { max_msgs_por_minuto: 8, max_msgs_por_dia: 150, max_chars_entrada: 1200, historico_msgs: 12 },
  campanhas: { pausa_taxa_falha: 0.15, amostra_minima: 30, grupo_teste_tamanho: 20 },
  atendimento: { sla_min: 5, msg_transferencia: "", msg_fora_horario: "", msg_sla: "" }, bot_ativo: false,
};
type Parametros = Awaited<Parameters<typeof OficinaPage>[0]["searchParams"]> & Record<string, unknown>;

function atendimento(alteracoes: Partial<AtendimentoOficina> = {}): AtendimentoOficina {
  return {
    id: ID, unidade: "comauto", descricao: "Verificar ruído fictício no freio", status: "novo", criadoEm: INSTANTE,
    clienteNome: "Cliente fictício", veiculo: { modelo: "Modelo fictício", placa: "TST1A23" },
    responsavel: null, podeAssumir: false, ...alteracoes,
  };
}
function sucesso(atendimentos: AtendimentoOficina[] = []): ResultadoFilaOficina {
  return { ok: true, atendimentos, total: atendimentos.length, proximo: null };
}
async function renderizar(parametros: Parametros = {}): Promise<string> {
  return renderToStaticMarkup(await OficinaPage({ searchParams: Promise.resolve(parametros) }));
}
function formularios(html: string): string[] {
  return Array.from(html.matchAll(/<form\b[^>]*>[\s\S]*?<\/form>/g), m => m[0]);
}
function artigos(html: string): string[] {
  return Array.from(html.matchAll(/<article\b[^>]*>[\s\S]*?<\/article>/g), m => m[0]);
}
function texto(html: string): string {
  return html.replace(/<[^>]*>/g, "").replace(/\s+/g, " ").trim();
}
function links(html: string): Array<{ href: string; texto: string }> {
  return Array.from(html.matchAll(/<a\b[^>]*href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/g), m => ({
    href: m[1].replaceAll("&amp;", "&"), texto: texto(m[2]),
  }));
}

beforeEach(() => {
  vi.resetAllMocks();
  f.exigirAcesso.mockResolvedValue(USUARIO);
  f.getConfig.mockResolvedValue(CONFIG);
  f.listarAtendimentos.mockResolvedValue(sucesso());
  f.criarAtendimento.mockResolvedValue(undefined);
  f.assumirAtendimento.mockResolvedValue(undefined);
});
afterEach(() => {
  // Renderizar um formulário nunca deve executar a escrita.
  expect(f.criarAtendimento).not.toHaveBeenCalled();
  expect(f.assumirAtendimento).not.toHaveBeenCalled();
});

describe("página Oficina: guard e contrato da consulta", () => {
  it("aguarda o guard de Oficina antes de ler filtros, configuração ou fila", async () => {
    let liberar!: (usuario: Usuario) => void;
    f.exigirAcesso.mockImplementation(() => new Promise<Usuario>(resolve => { liberar = resolve; }));
    const leitura = vi.fn();
    const parametros = { get minhas() { leitura(); return "1"; } };
    const pagina = OficinaPage({ searchParams: Promise.resolve(parametros) });
    expect(f.exigirAcesso).toHaveBeenCalledExactlyOnceWith("oficina");
    expect(leitura).not.toHaveBeenCalled();
    expect(f.listarAtendimentos).not.toHaveBeenCalled();
    expect(f.getConfig).not.toHaveBeenCalled();
    liberar(USUARIO);
    renderToStaticMarkup(await pagina);
    expect(leitura).toHaveBeenCalled();
    expect(f.listarAtendimentos).toHaveBeenCalledExactlyOnceWith(USUARIO, { minhas: true, limite: 50, antes: null });
  });

  it("interrompe no guard recusado sem consultar a fila nem a configuração", async () => {
    const recusa = new Error("acesso_recusado_ficticio");
    f.exigirAcesso.mockRejectedValue(recusa);
    await expect(renderizar()).rejects.toBe(recusa);
    expect(f.exigirAcesso).toHaveBeenCalledExactlyOnceWith("oficina");
    expect(f.listarAtendimentos).not.toHaveBeenCalled();
    expect(f.getConfig).not.toHaveBeenCalled();
  });

  it.each([USUARIO, { ...USUARIO, id: OUTRO_ID, unidade: "santaluzia", unidades: ["santaluzia"] }])(
    "usa o ator integral da sessão atual, sem aceitar identidade da query ($unidade)", async ator => {
      f.exigirAcesso.mockResolvedValue(ator);
      await renderizar({ ator: EM_TRIAGEM_ID, p_ator: EM_TRIAGEM_ID, unidade: "unidade_forjada", papel: "admin" });
      expect(f.exigirAcesso).toHaveBeenCalledExactlyOnceWith("oficina");
      expect(f.listarAtendimentos).toHaveBeenCalledExactlyOnceWith(ator, { minhas: false, limite: 50, antes: null });
      expect(f.listarAtendimentos.mock.calls[0][0]).toBe(ator);
    },
  );

  it.each<Parametros>([
    { minhas: "true" }, { minhas: ["1", "0"] }, { antes: INSTANTE }, { antes_id: ID },
    { antes: "2026-02-30T17:45:59.123456Z", antes_id: ID },
    { antes: "2026-11-12T17:45:59.1234567Z", antes_id: ID },
    { antes: [INSTANTE], antes_id: ID }, { antes: INSTANTE, antes_id: `${ID}\n` },
    { antes: "https://destino-ficticio.invalid/", antes_id: ID },
  ])("não consulta com filtro/cursor inválido %j", async parametros => {
    const html = await renderizar(parametros);
    expect(f.exigirAcesso).toHaveBeenCalledExactlyOnceWith("oficina");
    expect(f.listarAtendimentos).not.toHaveBeenCalled();
    expect(f.getConfig).not.toHaveBeenCalled();
    expect(texto(html)).toContain("Confira os filtros da fila.");
    expect(links(html)).toContainEqual({ href: "/painel/oficina", texto: "Voltar ao início" });
    expect(formularios(html)).toHaveLength(0);
  });

  it("repassa minhas e o cursor com seis microssegundos sem reformatar o instante", async () => {
    await renderizar({ minhas: "1", antes: INSTANTE, antes_id: ID });
    expect(f.listarAtendimentos).toHaveBeenCalledExactlyOnceWith(USUARIO, {
      minhas: true, limite: 50, antes: { criadoEm: INSTANTE, id: ID },
    });
    expect(f.getConfig).toHaveBeenCalledTimes(1);
  });
});

describe("página Oficina: falha, dados autorizados e vazio", () => {
  it.each<Extract<ResultadoFilaOficina, { ok: false }>>([
    { ok: false, status: 503, motivo: "Não foi possível carregar a fila de Oficina. Tente novamente.", pendente: false },
    { ok: false, status: 503, motivo: "Não foi possível carregar a fila de Oficina. Tente novamente.", pendente: true },
    { ok: false, status: 404, motivo: "A fila não está disponível no seu acesso atual.", pendente: false },
  ])("mostra a falha $status (migration pendente: $pendente) sem fabricar fila vazia ou ações", async falha => {
    f.listarAtendimentos.mockResolvedValue(falha);
    const html = await renderizar({ msg: "criado" });
    expect(html).toContain('role="alert"');
    expect(texto(html)).toContain(falha.motivo);
    expect(formularios(html)).toHaveLength(0);
    expect(artigos(html)).toHaveLength(0);
    expect(html).not.toContain('id="nova-solicitacao"');
    expect(html).not.toContain("Registrar solicitação");
    expect(html).not.toContain("Iniciar triagem");
    expect(html).not.toContain("solicitações nesta visão");
    expect(html).not.toContain("Nenhuma solicitação nesta etapa.");
    expect(html).not.toContain('role="status"');
  });

  it("renderiza os campos públicos do DTO, escapa HTML e usa o fuso configurado sem inventar valores", async () => {
    const dto = Object.assign(atendimento({
      clienteNome: "Cliente fictício <b>& Maria</b>",
      descricao: "<script>marcador_ficticio</script>\nFreio & revisão",
      veiculo: { modelo: 'Modelo fictício <img src="x">', placa: "TST1A23" },
    }), { clienteTelefone: "5511900000099", emailPrivado: "oculto@example.invalid", notaInterna: "nota_nao_autorizada_ficticia", precoEstimado: 98765.43 });
    const triagem = atendimento({
      id: EM_TRIAGEM_ID, clienteNome: "Segundo cliente fictício", status: "em_triagem", unidade: "santaluzia", veiculo: null,
      responsavel: { id: OUTRO_ID, nome: "Técnica fictícia <i>Maria</i>" },
    });
    f.listarAtendimentos.mockResolvedValue({ ok: true, atendimentos: [dto, triagem], total: 1234, proximo: null });
    const html = await renderizar({ antes: INSTANTE, antes_id: ID });
    const cartoes = artigos(html);
    expect(cartoes).toHaveLength(2);
    expect(cartoes[0]).toContain("Cliente fictício &lt;b&gt;&amp; Maria&lt;/b&gt;");
    expect(cartoes[0]).toContain("&lt;script&gt;marcador_ficticio&lt;/script&gt;\nFreio &amp; revisão");
    expect(cartoes[0]).toContain("Modelo fictício &lt;img src=&quot;x&quot;&gt; · TST1A23");
    expect(cartoes[0]).toContain(`dateTime="${INSTANTE}"`);
    expect(texto(cartoes[0])).toContain("12/11 às 13:45");
    expect(texto(cartoes[0])).toContain("Sem responsável");
    expect(cartoes[1]).toContain("Técnica fictícia &lt;i&gt;Maria&lt;/i&gt;");
    expect(texto(cartoes[1])).toContain("santaluzia");
    expect(texto(html)).toContain("1.234 solicitações nesta visão · 2 nesta página");
    for (const proibido of ["<script>marcador_ficticio", '<img src="x">', "<b>& Maria</b>", "5511900000099", "oculto@example.invalid", "nota_nao_autorizada_ficticia", "98765", "R$"]) {
      expect(html).not.toContain(proibido);
    }
    expect(html).not.toContain("Transferir");
    expect(html).not.toContain("arrastar");
  });

  it("distingue uma fila vazia legítima de falha e mantém somente o cadastro disponível", async () => {
    const html = await renderizar();
    expect(texto(html)).toContain("0 solicitações nesta visão · 0 nesta página");
    expect(artigos(html)).toHaveLength(0);
    expect(html.match(/Nenhuma solicitação nesta etapa\./g)).toHaveLength(2);
    expect(formularios(html)).toHaveLength(1);
    expect(html).toContain('id="nova-solicitacao"');
    expect(html).toContain("Registrar solicitação");
    expect(html).not.toContain("Iniciar triagem");
    expect(html).not.toContain('role="alert"');
    expect(links(html).some(link => link.texto === "Ver próximas solicitações")).toBe(false);
  });
});

describe("quadro Oficina: capacidade e responsabilidade", () => {
  it.each([false, true])("somente o DTO podeAssumir gera formulário de triagem (minhas=%s)", minhas => {
    const html = renderToStaticMarkup(createElement(QuadroOficina, {
      atendimentos: [
        atendimento(),
        atendimento({ id: OUTRO_ID, clienteNome: "Cliente assumível fictício", podeAssumir: true }),
        atendimento({ id: EM_TRIAGEM_ID, status: "em_triagem", responsavel: { id: USUARIO.id, nome: "Responsável fictícia" } }),
      ], minhas, fuso: CONFIG.fuso_offset,
    }));
    const cartoes = artigos(html);
    expect(cartoes).toHaveLength(3);
    expect(formularios(cartoes[0])).toHaveLength(0);
    const form = formularios(cartoes[1]);
    expect(form).toHaveLength(1);
    expect(form[0]).toContain(`name="solicitacao" value="${OUTRO_ID}"`);
    expect(form[0]).not.toContain(`value="${ID}"`);
    expect(form[0]).toContain("Iniciar triagem");
    expect(Array.from(form[0].matchAll(/<input\b[^>]*name="([^"]*)"/g), m => m[1])).toEqual(minhas ? ["solicitacao", "minhas"] : ["solicitacao"]);
    if (minhas) expect(form[0]).toContain('name="minhas" value="1"');
    expect(texto(cartoes[2])).toContain("Responsável: Responsável fictícia");
    expect(formularios(cartoes[2])).toHaveLength(0);
    expect(formularios(html)).toHaveLength(1);
    expect(html).not.toMatch(/<select\b|Transferir|Reatribuir|Devolver|draggable=/);
  });
});

describe("página Oficina: navegação e mensagens", () => {
  it.each([false, true])("preserva a visão e a precisão no próximo cursor e limpa o cursor no início (minhas=%s)", async minhas => {
    const proximoInstante = "2026-11-12T16:45:59.654321Z";
    const pagina = Array.from({ length: 50 }, (_, indice) => atendimento({
      id: `bf200000-0000-4000-8000-${String(indice + 1).padStart(12, "0")}`,
      clienteNome: `Cliente fictício ${indice + 1}`, criadoEm: proximoInstante,
    }));
    const proximo = { criadoEm: proximoInstante, id: pagina[49].id };
    f.listarAtendimentos.mockResolvedValue({ ok: true, atendimentos: pagina, total: 51, proximo });
    const html = await renderizar({
      minhas: minhas ? "1" : "0", antes: INSTANTE, antes_id: ID,
      next: "https://destino-ficticio.invalid/", returnTo: "//destino-ficticio.invalid/", msg: "ignorada_ficticia",
    });
    const ancoras = links(html);
    const seguinte = ancoras.find(link => link.texto === "Ver próximas solicitações");
    expect(seguinte).toBeDefined();
    const url = new URL(seguinte!.href, "https://painel.example.invalid");
    expect(url.origin).toBe("https://painel.example.invalid");
    expect(url.pathname).toBe("/painel/oficina");
    expect(url.searchParams.get("minhas")).toBe(minhas ? "1" : null);
    expect(url.searchParams.get("antes")).toBe(proximoInstante);
    expect(url.searchParams.get("antes_id")).toBe(proximo.id);
    expect(Array.from(url.searchParams.keys())).toEqual(minhas ? ["minhas", "antes", "antes_id"] : ["antes", "antes_id"]);
    expect(ancoras).toContainEqual({ href: `/painel/oficina${minhas ? "?minhas=1" : ""}`, texto: "Voltar ao início" });
    expect(ancoras.every(link => link.href.startsWith("/") && !link.href.startsWith("//") || link.href.startsWith("#"))).toBe(true);
    expect(html).not.toContain("destino-ficticio.invalid");
    expect(f.listarAtendimentos).toHaveBeenCalledExactlyOnceWith(USUARIO, {
      minhas, limite: 50, antes: { criadoEm: INSTANTE, id: ID },
    });
    const cadastro = formularios(html).find(form => form.includes("Registrar solicitação"));
    expect(cadastro).toBeDefined();
    expect(cadastro!.includes('name="minhas" value="1"')).toBe(minhas);
  });

  it.each([
    ["criado", "Solicitação registrada na fila de Oficina."], ["triagem", "Triagem iniciada."],
    ["erro_triagem", "Não foi possível iniciar a triagem. Tente novamente."],
  ])("renderiza a mensagem conhecida %s como status", async (msg, mensagem) => {
    const html = await renderizar({ msg });
    expect(html).toContain('role="status"');
    expect(texto(html)).toContain(mensagem);
  });

  it.each<unknown>([
    '<img src=x onerror="marcador_ficticio">', "mensagem_crua_ficticia", "__proto__", "constructor", "toString", ["criado"], { msg: "criado" },
  ])("ignora mensagem fora da whitelist, inclusive HTML e valores não escalares: %j", async msg => {
    const html = await renderizar({ msg });
    expect(html).not.toContain('role="status"');
    expect(html).not.toContain("marcador_ficticio");
    expect(html).not.toContain("mensagem_crua_ficticia");
    expect(html).not.toContain("Solicitação registrada na fila de Oficina.");
    expect(formularios(html)).toHaveLength(1);
  });
});
