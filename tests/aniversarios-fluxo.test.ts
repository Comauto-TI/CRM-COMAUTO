import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Usuario } from "@/lib/auth";
import { GET, POST } from "@/app/api/painel/notificacoes/route";
import { contatoAniversarioAction, lembrarAniversarioAction } from "@/app/painel/_acoes/aniversarios";

const fixture = vi.hoisted(() => ({
  usuarioApi: vi.fn(), exigirAcesso: vi.fn(), getConfig: vi.fn(),
  listarNotificacoes: vi.fn(), contarNaoLidas: vi.fn(), marcarLidas: vi.fn(),
  lembretesInsistentes: vi.fn(), marcarContatoAniversario: vi.fn(), ativarLembreteAniversario: vi.fn(),
  revalidatePath: vi.fn(), redirect: vi.fn(),
}));
vi.mock("@/lib/auth", () => ({ usuarioApi: fixture.usuarioApi, exigirAcesso: fixture.exigirAcesso }));
vi.mock("@/lib/config", () => ({ getConfig: fixture.getConfig }));
vi.mock("@/lib/notificacoes", () => ({
  listarNotificacoes: fixture.listarNotificacoes, contarNaoLidas: fixture.contarNaoLidas,
  marcarLidas: fixture.marcarLidas, linkInternoSeguro: (link: string | null) => link,
}));
vi.mock("@/modulos/vendas/aniversarios-dados", () => ({
  lembretesInsistentes: fixture.lembretesInsistentes,
  marcarContatoAniversario: fixture.marcarContatoAniversario,
  ativarLembreteAniversario: fixture.ativarLembreteAniversario,
}));
vi.mock("next/cache", () => ({ revalidatePath: fixture.revalidatePath }));
vi.mock("next/navigation", () => ({ redirect: fixture.redirect }));

const clienteId = "30000000-0000-4000-8000-000000000101";
const vendedor: Usuario = {
  id: "30000000-0000-4000-8000-000000000001", nome: "Vendedor fictício",
  email: "vendedor@example.test", papel: "vendedor", setor: "vendas",
  unidade: "comauto", unidades: ["comauto"],
};
const notif = {
  id: "30000000-0000-4000-8000-000000000201", tipo: "lead", titulo: "Lead fictício",
  corpo: null, link: "/painel/vendas", criado_em: "2026-11-10T20:00:00Z", lida_em: null,
};
const insistente = { id: "30000000-0000-4000-8000-000000000301", clienteId, nome: "Cliente fictício", dias: -8, dataAlvo: "2026-11-02" };
const erroContato = "Não foi possível registrar o contato. Tente novamente.";

function requisicao(corpo: unknown) {
  return new Request("http://localhost/api/painel/notificacoes", {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(corpo),
  });
}
function formulario(data = insistente.dataAlvo) {
  const f = new FormData();
  f.set("cliente_id", clienteId);
  f.set("data_aniversario", data);
  return f;
}
function destinoErro(motivo: string) {
  return `/painel?erro_aniversario=${encodeURIComponent(motivo)}`;
}

beforeEach(() => {
  vi.resetAllMocks();
  vi.useFakeTimers();
  // Ainda é dia10 no fuso local: a API e as actions não podem usar o prefixo UTC.
  vi.setSystemTime(new Date("2026-11-11T02:00:00Z"));
  fixture.usuarioApi.mockResolvedValue(vendedor);
  fixture.exigirAcesso.mockResolvedValue(vendedor);
  fixture.getConfig.mockResolvedValue({ fuso_offset: "-03:00" });
  fixture.listarNotificacoes.mockResolvedValue([notif]);
  fixture.contarNaoLidas.mockResolvedValue(4);
  fixture.lembretesInsistentes.mockResolvedValue([insistente]);
  fixture.marcarContatoAniversario.mockResolvedValue({ ok: true });
  fixture.ativarLembreteAniversario.mockResolvedValue({ ok: true });
  fixture.redirect.mockImplementation((url: string) => { throw new Error(`NEXT_REDIRECT:${url}`); });
});
afterEach(() => vi.useRealTimers());

describe("F5 notificações: leitura independente dos insistentes", () => {
  it("transporta dataAlvo e usa data local sem perder notificações normais", async () => {
    const resposta = await GET();
    expect(resposta.status).toBe(200);
    expect(await resposta.json()).toEqual({
      naoLidas: [{ id: notif.id, tipo: notif.tipo, titulo: notif.titulo, corpo: null, link: notif.link, criado_em: notif.criado_em }],
      total: 4, insistentes: [insistente], erroInsistentes: false,
    });
    expect(fixture.lembretesInsistentes).toHaveBeenCalledExactlyOnceWith(vendedor, "2026-11-10");
    expect(resposta.headers.get("Cache-Control")).toBe("no-store");
  });
  it.each(["lembretes", "configuração"])("falha na leitura de %s preserva as outras notificações", async origem => {
    if (origem === "lembretes") fixture.lembretesInsistentes.mockRejectedValue(new Error("fixture_leitura_incompleta"));
    else fixture.getConfig.mockRejectedValue(new Error("fixture_configuração"));
    const resposta = await GET();
    expect(resposta.status).toBe(200);
    const corpo = await resposta.json();
    expect(corpo.naoLidas).toHaveLength(1);
    expect(corpo.naoLidas[0].id).toBe(notif.id);
    expect(corpo).toMatchObject({ total: 4, insistentes: [], erroInsistentes: true });
  });
  it("Peças recebe suas notificações sem consultar aniversários de Vendas", async () => {
    fixture.usuarioApi.mockResolvedValue({ ...vendedor, papel: "pecas", setor: "pecas" });
    expect(await (await GET()).json()).toMatchObject({ total: 4, insistentes: [], erroInsistentes: false });
    expect(fixture.lembretesInsistentes).not.toHaveBeenCalled();
    expect(fixture.getConfig).not.toHaveBeenCalled();
  });
});

describe("F5 notificações: confirmação com resultado verificável", () => {
  it("envia a data antiga exata e só confirma a gravação bem-sucedida", async () => {
    const resposta = await POST(requisicao({ contatoAniversario: clienteId, dataAniversario: insistente.dataAlvo }));
    expect(resposta.status).toBe(200);
    expect(await resposta.json()).toEqual({ ok: true });
    expect(fixture.marcarContatoAniversario).toHaveBeenCalledExactlyOnceWith(vendedor, clienteId, "2026-11-10", insistente.dataAlvo);
    expect(fixture.marcarLidas).not.toHaveBeenCalled();
  });
  it("mantém compatibilidade com chamada sem data explícita", async () => {
    expect((await POST(requisicao({ contatoAniversario: clienteId }))).status).toBe(200);
    expect(fixture.marcarContatoAniversario).toHaveBeenCalledExactlyOnceWith(vendedor, clienteId, "2026-11-10", undefined);
  });
  it("devolve falha de domínio como400, sem ok verdadeiro", async () => {
    fixture.marcarContatoAniversario.mockResolvedValue({ ok: false, motivo: erroContato });
    const resposta = await POST(requisicao({ contatoAniversario: clienteId, dataAniversario: insistente.dataAlvo }));
    expect(resposta.status).toBe(400);
    expect(await resposta.json()).toEqual({ ok: false, motivo: erroContato });
  });
  it("não revela erro interno e devolve503 se o serviço lançar exceção", async () => {
    fixture.marcarContatoAniversario.mockRejectedValue(new Error("fixture_interno"));
    const resposta = await POST(requisicao({ contatoAniversario: clienteId, dataAniversario: insistente.dataAlvo }));
    expect(resposta.status).toBe(503);
    expect(await resposta.json()).toEqual({ ok: false, motivo: erroContato });
  });
  it.each([23, null, "11/11/2026", "2026-1-02"])("recusa formato inválido de data %s antes de gravar", async dataAniversario => {
    expect((await POST(requisicao({ contatoAniversario: clienteId, dataAniversario }))).status).toBe(400);
    expect(fixture.marcarContatoAniversario).not.toHaveBeenCalled();
  });
  it("recusa JSON null com400 em vez de lançar uma exceção", async () => {
    const resposta = await POST(requisicao(null));
    expect(resposta.status).toBe(400);
    expect(fixture.marcarContatoAniversario).not.toHaveBeenCalled();
    expect(fixture.marcarLidas).not.toHaveBeenCalled();
  });
  it("usuário sem Vendas não marca contato de aniversário", async () => {
    fixture.usuarioApi.mockResolvedValue({ ...vendedor, papel: "pecas", setor: "pecas" });
    expect((await POST(requisicao({ contatoAniversario: clienteId, dataAniversario: insistente.dataAlvo }))).status).toBe(403);
    expect(fixture.marcarContatoAniversario).not.toHaveBeenCalled();
  });
  it("sem sessão não consulta dados nem escreve", async () => {
    fixture.usuarioApi.mockResolvedValue(null);
    expect((await GET()).status).toBe(401);
    expect((await POST(requisicao({ contatoAniversario: clienteId }))).status).toBe(401);
    expect(fixture.listarNotificacoes).not.toHaveBeenCalled();
    expect(fixture.marcarContatoAniversario).not.toHaveBeenCalled();
  });
});

describe("F5 server actions: sucesso e erro chegam à Visão Geral", () => {
  it("contato da data exata revalida somente após confirmação", async () => {
    await contatoAniversarioAction(formulario());
    expect(fixture.exigirAcesso).toHaveBeenCalledExactlyOnceWith("vendas");
    expect(fixture.marcarContatoAniversario).toHaveBeenCalledExactlyOnceWith(vendedor, clienteId, "2026-11-10", insistente.dataAlvo);
    expect(fixture.revalidatePath).toHaveBeenCalledExactlyOnceWith("/painel");
    expect(fixture.redirect).not.toHaveBeenCalled();
  });
  it("falha de contato redireciona motivo codificado sem revalidar como sucesso", async () => {
    const motivo = "Cliente fora da carteira / unidade & inválido?";
    fixture.marcarContatoAniversario.mockResolvedValue({ ok: false, motivo });
    await expect(contatoAniversarioAction(formulario())).rejects.toThrow(`NEXT_REDIRECT:${destinoErro(motivo)}`);
    expect(fixture.redirect).toHaveBeenCalledExactlyOnceWith(destinoErro(motivo));
    expect(fixture.revalidatePath).not.toHaveBeenCalled();
  });
  it("exceção de contato redireciona erro público, sem revelar conteúdo interno", async () => {
    fixture.marcarContatoAniversario.mockRejectedValue(new Error("fixture_interno"));
    await expect(contatoAniversarioAction(formulario())).rejects.toThrow(`NEXT_REDIRECT:${destinoErro(erroContato)}`);
    expect(fixture.revalidatePath).not.toHaveBeenCalled();
  });
  it("ativação bem-sucedida revalida e usa a data local", async () => {
    await lembrarAniversarioAction(formulario());
    expect(fixture.exigirAcesso).toHaveBeenCalledExactlyOnceWith("vendas");
    expect(fixture.ativarLembreteAniversario).toHaveBeenCalledExactlyOnceWith(vendedor, clienteId, "2026-11-10");
    expect(fixture.revalidatePath).toHaveBeenCalledExactlyOnceWith("/painel");
  });
  it.each(["retorno", "exceção"])("ativação com %s de falha redireciona sem revalidar", async modo => {
    const motivo = "Não foi possível ativar o lembrete. Tente novamente.";
    if (modo === "retorno") fixture.ativarLembreteAniversario.mockResolvedValue({ ok: false, motivo });
    else fixture.ativarLembreteAniversario.mockRejectedValue(new Error("fixture_interno"));
    await expect(lembrarAniversarioAction(formulario())).rejects.toThrow(`NEXT_REDIRECT:${destinoErro(motivo)}`);
    expect(fixture.revalidatePath).not.toHaveBeenCalled();
  });
  it("negação de acesso acontece antes de consultar configuração ou gravar", async () => {
    fixture.exigirAcesso.mockRejectedValue(new Error("fixture_sem_acesso"));
    await expect(contatoAniversarioAction(formulario())).rejects.toThrow("fixture_sem_acesso");
    await expect(lembrarAniversarioAction(formulario())).rejects.toThrow("fixture_sem_acesso");
    expect(fixture.getConfig).not.toHaveBeenCalled();
    expect(fixture.marcarContatoAniversario).not.toHaveBeenCalled();
    expect(fixture.ativarLembreteAniversario).not.toHaveBeenCalled();
  });
});
