import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Usuario } from "@/lib/auth";
import { assumirAtendimentoVendas, devolverAtendimentoVendas, obterDialogoVendas, responderAtendimentoVendas } from "@/modulos/vendas/atendimento";

const f = vi.hoisted(() => ({ rpc: vi.fn(), responder: vi.fn() }));
vi.mock("@/lib/supabase/admin", () => ({ db: () => ({ rpc: f.rpc }) }));
vi.mock("@/lib/messaging/outbound", () => ({ responderLivre: f.responder }));
vi.mock("@/lib/env", () => ({ valoresSecretos: () => [] }));
const ator = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", op = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const atendimento = "cccccccc-cccc-4ccc-8ccc-cccccccccccc", mensagem = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
const cliente = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee", conversa = "ffffffff-ffff-4fff-8fff-ffffffffffff";
const u: Usuario = { id: ator, nome: "Vendedor", email: "vendas@fixture.invalid", papel: "vendedor", setor: "vendas", unidade: "comauto", unidades: ["comauto"] };
const dialogo = { ok: true, id: atendimento, oportunidadeId: op, versao: 1, clienteNome: "Cliente", estado: "minha", janelaAberta: true, podeAssumir: false, podeDevolver: true, mensagens: [], revisaoPendente: false };
const reserva = { ok: true, id: atendimento, oportunidadeId: op, versao: 1, clienteId: cliente, conversaId: conversa, mensagemId: mensagem, despachar: true };
const autorizado = { ok: true, id: atendimento, clienteId: cliente, conversaId: conversa, mensagemId: mensagem };
beforeEach(() => {
  vi.resetAllMocks();
  f.rpc.mockImplementation(async (nome: string) => ({ error: null, data: nome === "vendas_dialogo" ? dialogo : nome === "vendas_reservar_resposta" ? reserva : autorizado }));
  f.responder.mockImplementation(async (a: { contextoAtendimento: { autorizar: () => Promise<boolean> } }) =>
    await a.contextoAtendimento.autorizar() ? { ok: true } : { ok: false, motivo: "atendimento_indisponivel" });
});

describe("adaptador do atendimento de Vendas", () => {
  it("consulta somente a política de Vendas com ator autenticado e identidade normalizada", async () => {
    expect(await obterDialogoVendas(u, op.toUpperCase())).toEqual(dialogo);
    expect(f.rpc).toHaveBeenCalledExactlyOnceWith("vendas_dialogo", { p_oportunidade: op, p_ator: ator });
  });
  it.each(["cotacaoId", "registroId"])("não aceita identidade de outro contrato: %s", async chave => {
    f.rpc.mockResolvedValue({ error: null, data: { ...dialogo, oportunidadeId: undefined, [chave]: op } });
    expect(await obterDialogoVendas(u, op)).toMatchObject({ ok: false, status: 503 });
  });
  it.each([
    { papel: "pecas", setor: "pecas" }, { papel: "recepcao", setor: "oficina" },
    { papel: "gerente", setor: "pecas" }, { papel: "financeiro", setor: "administracao" },
  ])("perfil %j não pode atravessar o adaptador", async perfil => {
    const outro = { ...u, ...perfil } as Usuario;
    for (const r of [await obterDialogoVendas(outro, op), await assumirAtendimentoVendas(outro, op, 0),
      await devolverAtendimentoVendas(outro, op, 0), await responderAtendimentoVendas(outro, op, 0, mensagem, "Olá")]) {
      expect(r).toMatchObject({ ok: false, status: 403 });
    }
    expect(f.rpc).not.toHaveBeenCalled(); expect(f.responder).not.toHaveBeenCalled();
  });
  it.each(["gerente", "admin"] as const)("supervisão %s mantém capacidades retornadas pelo banco", async papel => {
    const livre = { ...dialogo, id: null, versao: 0, estado: "livre", podeAssumir: true, podeDevolver: false };
    f.rpc.mockResolvedValue({ error: null, data: livre });
    expect(await obterDialogoVendas({ ...u, papel, setor: papel === "admin" ? "administracao" : "vendas" }, op)).toEqual(livre);
  });
  it.each([[assumirAtendimentoVendas, "assumir", "minha"], [devolverAtendimentoVendas, "devolver", "livre"]] as const)("%s usa versão exata sem reatribuir por fora", async (fn, acao, estado) => {
    f.rpc.mockResolvedValue({ error: null, data: { ok: true, id: atendimento, oportunidadeId: op, versao: 2, estado } });
    expect(await fn(u, op, 1)).toEqual({ ok: true, id: atendimento, oportunidadeId: op, versao: 2, estado });
    expect(f.rpc).toHaveBeenCalledExactlyOnceWith(`vendas_${acao}_atendimento`, { p_oportunidade: op, p_ator: ator, p_versao: 1 });
  });
  it("leva ao outbound somente corpo mascarado e contexto derivado da reserva de Vendas", async () => {
    expect(await responderAtendimentoVendas(u, op, 1, mensagem, "CPF 111.444.777-35")).toEqual({ ok: true, versao: 1 });
    expect(f.rpc).toHaveBeenNthCalledWith(1, "vendas_reservar_resposta", { p_oportunidade: op, p_ator: ator, p_versao: 1, p_mensagem: mensagem, p_texto: "CPF [CPF removido]" });
    expect(f.rpc).toHaveBeenNthCalledWith(2, "vendas_autorizar_resposta", { p_oportunidade: op, p_ator: ator, p_versao: 1, p_mensagem: mensagem });
    expect(f.responder).toHaveBeenCalledExactlyOnceWith({ clienteId: cliente, texto: "CPF [CPF removido]", autor: "atendente",
      contextoAtendimento: { id: atendimento, conversaId: conversa, mensagemId: mensagem, autorizar: expect.any(Function) } });
  });
  it("replay já enviado não repete o outbound", async () => {
    f.rpc.mockResolvedValue({ error: null, data: { ...reserva, despachar: false } });
    expect(await responderAtendimentoVendas(u, op, 1, mensagem, "Olá")).toEqual({ ok: true, versao: 1 });
    expect(f.responder).not.toHaveBeenCalled();
  });
  it.each(["vendas_reservar_resposta", "vendas_autorizar_resposta"])("nova ambiguidade em %s bloqueia a tentativa", async nome => {
    f.rpc.mockImplementation(async (n: string) => ({ error: null, data: n === nome ? { ok: false, codigo: "origem_ambigua" } : reserva }));
    expect(await responderAtendimentoVendas(u, op, 1, mensagem, "Olá")).toMatchObject({ ok: false, status: 409, erro: expect.stringContaining("revisão") });
    if (nome === "vendas_reservar_resposta") expect(f.responder).not.toHaveBeenCalled();
  });
  it.each(["optout", "janela_24h_fechada", "envio_incerto"])("preserva recusa do outbound: %s", async motivo => {
    f.responder.mockResolvedValue({ ok: false, motivo });
    const r = await responderAtendimentoVendas(u, op, 1, mensagem, "Olá");
    expect(r).toMatchObject({ ok: false, status: 409 });
    if (motivo === "envio_incerto") expect(r).toHaveProperty("incerto", true);
  });
});
