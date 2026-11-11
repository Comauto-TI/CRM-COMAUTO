import { beforeEach, describe, expect, it, vi } from "vitest";
import { rotearLead, type DadosLead } from "@/modulos/vendas/leads";
import { registrarLeadVendasBot } from "@/modulos/vendas/qualificacao-bot";

const fixture = vi.hoisted(() => ({ db: vi.fn(), from: vi.fn(), rpc: vi.fn(), nucleo: vi.fn(), notificar: vi.fn(), auditar: vi.fn() }));
vi.mock("@/lib/supabase/admin", () => ({ db: fixture.db }));
vi.mock("@/lib/usuarios", () => ({ nucleoAplicado: fixture.nucleo }));
vi.mock("@/lib/notificacoes", () => ({ notificar: fixture.notificar }));
vi.mock("@/lib/audit", () => ({ auditar: fixture.auditar }));

const clienteId = "60000000-0000-4000-8000-000000000001";
const conversaId = "60000000-0000-4000-8000-000000000101";
const oportunidadeId = "60000000-0000-4000-8000-000000000201";
const outroId = "60000000-0000-4000-8000-000000000999";
const lead: DadosLead = {
  clienteId, conversaId, referencia: "wamid.fixture-vendas", interesse: "novo", modelo: "Polo",
  pagamento: "financiamento", prazo: "ate_30_dias", temTroca: true, trocaDescricao: "Gol 2018",
  resumo: "Interesse em veículo novo", clienteConfirmou: false,
};
const sucesso = { ok: true, oportunidade_id: oportunidadeId, novo: true, ja_registrado: false };
const contextoInvalido = { ok: false, motivo: "contexto_vendas_invalido" };
const indisponivel = { ok: false, motivo: "vendas_indisponivel" };
const argumentos = {
  p_conversa_id: conversaId, p_cliente_id: clienteId, p_referencia: lead.referencia, p_funil: "novos",
  p_modelo: "Polo", p_pagamento: "financiamento", p_prazo: "ate_30_dias", p_tem_troca: true,
  p_troca_descricao: "Gol 2018", p_resumo: lead.resumo, p_cliente_confirmou: false,
};

function semEfeitosJs() {
  expect(fixture.from).not.toHaveBeenCalled();
  expect(fixture.notificar).not.toHaveBeenCalled();
  expect(fixture.auditar).not.toHaveBeenCalled();
}

beforeEach(() => {
  vi.resetAllMocks();
  fixture.db.mockReturnValue({ from: fixture.from, rpc: fixture.rpc });
  fixture.from.mockImplementation(() => { throw new Error("Consulta/mutação JS fora da transação de Vendas"); });
  fixture.nucleo.mockResolvedValue(true);
  fixture.rpc.mockResolvedValue({ data: sucesso, error: null });
});

describe("A1.1c rotearLead usa o RPC real do wrapper em Vendas", () => {
  it.each([["novo", "novos"], ["seminovo", "seminovos"]])("interesse %s escolhe funil%s sem pré-consulta de cliente", async (interesse, funil) => {
    expect(await rotearLead({ ...lead, interesse } as DadosLead)).toEqual({ ok: true, destino: "vendas", novo: true });
    expect(fixture.rpc).toHaveBeenCalledExactlyOnceWith("registrar_lead_vendas_bot", { ...argumentos, p_funil: funil });
    expect(fixture.nucleo).toHaveBeenCalledTimes(1);
    expect(fixture.nucleo.mock.invocationCallOrder[0]).toBeLessThan(fixture.rpc.mock.invocationCallOrder[0]);
    semEfeitosJs();
  });
  it.each([[true, false], [false, false], [true, true], [false, true]])("expõe só novo=%s quando ja_registrado=%s", async (novo, ja_registrado) => {
    fixture.rpc.mockResolvedValue({ data: { ...sucesso, novo, ja_registrado, vendedor_id: outroId, unidade: "comauto", detalhe: "fixture_interno" }, error: null });
    expect(await rotearLead(lead)).toEqual({ ok: true, destino: "vendas", novo });
    expect(await registrarLeadVendasBot(lead, "novos")).toEqual({ ok: true, novo });
    semEfeitosJs();
  });
  it("sem núcleo não tenta RPC nem executa o fluxo solto antigo", async () => {
    fixture.nucleo.mockResolvedValue(false);
    expect(await rotearLead(lead)).toEqual({ ok: false, motivo: "crm_indisponivel" });
    expect(fixture.rpc).not.toHaveBeenCalled();
    semEfeitosJs();
  });
  it("Agenda retorna antes do núcleo e de qualquer banco", async () => {
    fixture.nucleo.mockResolvedValue(false);
    expect(await rotearLead({ ...lead, interesse: "oficina" })).toEqual({ ok: true, destino: "agenda" });
    expect(fixture.nucleo).not.toHaveBeenCalled();
    expect(fixture.db).not.toHaveBeenCalled();
    semEfeitosJs();
  });
  it("metadados injetados não viram unidade, dono, etapa ou qualificação autoritativos", async () => {
    const entrada = {
      ...lead, unidade: "santaluzia", unidadeId: outroId, owner: outroId, vendedor_id: outroId,
      oportunidade_id: outroId, etapa_id: outroId, qualificacao: "qualificado", temperatura: "quente",
      origem: "evento", papel: "admin", unidades: ["santaluzia"], ator: outroId,
    };
    expect(await rotearLead(entrada)).toEqual({ ok: true, destino: "vendas", novo: true });
    expect(fixture.rpc).toHaveBeenCalledExactlyOnceWith("registrar_lead_vendas_bot", argumentos);
    expect(Object.keys(fixture.rpc.mock.calls[0][1]).sort()).toEqual(Object.keys(argumentos).sort());
    semEfeitosJs();
  });
});

describe("A1.1c normalização preserva dados conhecidos e identidade", () => {
  it("trim e limites de modelo120, troca300 e resumo300 são aplicados antes do RPC", async () => {
    await rotearLead({ ...lead, modelo: "  " + "M".repeat(140) + "  ", trocaDescricao: " \t" + "T".repeat(350) + "  ", resumo: " \n" + "R".repeat(350) + "  " });
    expect(fixture.rpc).toHaveBeenCalledExactlyOnceWith("registrar_lead_vendas_bot", {
      ...argumentos, p_modelo: "M".repeat(120), p_troca_descricao: "T".repeat(300), p_resumo: "R".repeat(300),
    });
    semEfeitosJs();
  });
  it("remove borda criada quando o corte120/300 termina em espaço interno", async () => {
    await rotearLead({
      ...lead, modelo: "M".repeat(119) + " excedente", trocaDescricao: "T".repeat(299) + " excedente",
      resumo: "R".repeat(299) + " excedente",
    });
    expect(fixture.rpc).toHaveBeenCalledExactlyOnceWith("registrar_lead_vendas_bot", {
      ...argumentos, p_modelo: "M".repeat(119), p_troca_descricao: "T".repeat(299), p_resumo: "R".repeat(299),
    });
    semEfeitosJs();
  });
  it.each([null, "", "  \t "])("modelo e descrição vazios %j seguem nulos", async texto => {
    await registrarLeadVendasBot({ ...lead, modelo: texto, trocaDescricao: texto }, "novos");
    expect(fixture.rpc).toHaveBeenCalledExactlyOnceWith("registrar_lead_vendas_bot", { ...argumentos, p_modelo: null, p_troca_descricao: null });
  });
  it.each([null, false, true])("temTroca=%s é preservado sem converter desconhecido em não", async temTroca => {
    await rotearLead({ ...lead, temTroca });
    expect(fixture.rpc).toHaveBeenCalledExactlyOnceWith("registrar_lead_vendas_bot", {
      ...argumentos, p_tem_troca: temTroca, p_troca_descricao: temTroca === true ? lead.trocaDescricao : null,
    });
    semEfeitosJs();
  });
  it.each([false, true])("clienteConfirmou=%s segue como informação booleana, sem patch de qualificação JS", async clienteConfirmou => {
    await rotearLead({ ...lead, clienteConfirmou });
    expect(fixture.rpc).toHaveBeenCalledExactlyOnceWith("registrar_lead_vendas_bot", { ...argumentos, p_cliente_confirmou: clienteConfirmou });
    semEfeitosJs();
  });
  it("normaliza UUIDs e mantém referência com capitalização/espaço interno exatos", async () => {
    const conversa = "AAAAAAAA-AAAA-AAAA-AAAA-AAAAAAAAAAAA";
    const cliente = "BBBBBBBB-BBBB-BBBB-BBBB-BBBBBBBBBBBB";
    const referencia = "wamid.Referencia Exata";
    await registrarLeadVendasBot({ ...lead, conversaId: conversa, clienteId: cliente, referencia }, "novos");
    expect(fixture.rpc).toHaveBeenCalledExactlyOnceWith("registrar_lead_vendas_bot", {
      ...argumentos, p_conversa_id: conversa.toLowerCase(), p_cliente_id: cliente.toLowerCase(), p_referencia: referencia,
    });
  });
  it.each(["a_vista", "financiamento", "consorcio", "indefinido"])("pagamento %s permanece concreto ou indefinido", async pagamento => {
    await registrarLeadVendasBot({ ...lead, pagamento } as DadosLead, "novos");
    expect(fixture.rpc.mock.calls[0][1].p_pagamento).toBe(pagamento);
  });
  it.each(["imediato", "ate_30_dias", "ate_90_dias", "sem_prazo", "indefinido"])("prazo %s não recebe coerção", async prazo => {
    await registrarLeadVendasBot({ ...lead, prazo } as DadosLead, "novos");
    expect(fixture.rpc.mock.calls[0][1].p_prazo).toBe(prazo);
  });
});

describe("A1.1c entradas inválidas falham antes do RPC", () => {
  it.each([null, undefined, 1, "texto", []])("objeto lead inválido %j não lança", async valor => {
    expect(await registrarLeadVendasBot(valor as unknown as DadosLead, "novos")).toEqual(contextoInvalido);
    expect(await rotearLead(valor as unknown as DadosLead)).toEqual(contextoInvalido);
    expect(fixture.db).not.toHaveBeenCalled();
  });
  it.each([
    { conversaId: null }, { conversaId: undefined }, { conversaId: {} }, { conversaId: "" },
    { conversaId: conversaId.replaceAll("-", "") }, { conversaId: " " + conversaId }, { conversaId: conversaId + "\n" },
    { clienteId: null }, { clienteId: undefined }, { clienteId: 2 }, { clienteId: "" },
    { clienteId: clienteId + " " }, { clienteId: clienteId + "\n" }, { clienteId: "60000000-0000-4000-8000-00000000000z" },
    { referencia: null }, { referencia: undefined }, { referencia: 2 }, { referencia: {} }, { referencia: "" },
    { referencia: "x".repeat(513) }, { referencia: " " + lead.referencia }, { referencia: lead.referencia + "\t" },
    { modelo: 2 }, { modelo: undefined }, { trocaDescricao: 2 }, { trocaDescricao: undefined },
    { resumo: null }, { resumo: 2 }, { resumo: "" }, { resumo: "  \t\n " },
    { pagamento: "invalido" }, { pagamento: null }, { pagamento: "constructor" }, { pagamento: "__proto__" },
    { prazo: "invalido" }, { prazo: undefined }, { prazo: "toString" },
    { temTroca: undefined }, { temTroca: "false" }, { temTroca: 0 },
    { clienteConfirmou: undefined }, { clienteConfirmou: null }, { clienteConfirmou: "true" }, { clienteConfirmou: 1 },
  ])("recusa campo de runtime %j sem chamar consultas ou mutações JS", async patch => {
    const d = { ...lead, ...patch } as unknown as DadosLead;
    expect(await registrarLeadVendasBot(d, "novos")).toEqual(contextoInvalido);
    expect(await rotearLead(d)).toEqual(contextoInvalido);
    expect(fixture.db).not.toHaveBeenCalled();
    semEfeitosJs();
  });
  it.each([null, undefined, "novo", "seminovo", "PECAS", {}, 2, "constructor"])("recusa funil inválido %j", async valor => {
    expect(await registrarLeadVendasBot(lead, valor as "novos")).toEqual(contextoInvalido);
    expect(fixture.db).not.toHaveBeenCalled();
  });
  it.each(["x", "x".repeat(512)])("aceita referência nos limites1..512 (%s)", async referencia => {
    expect(await registrarLeadVendasBot({ ...lead, referencia }, "novos")).toEqual({ ok: true, novo: true });
    expect(fixture.rpc.mock.calls[0][1].p_referencia).toBe(referencia);
  });
});

describe("A1.1c resposta negativa ou incompleta não confirma ao agente", () => {
  it.each([
    null, [], "fixture_interno", {}, { ...sucesso, ok: "true" }, { ...sucesso, ok: false, motivo: "fixture_interno" },
    { ...sucesso, oportunidade_id: null }, { ...sucesso, oportunidade_id: 2 },
    { ...sucesso, oportunidade_id: oportunidadeId.replaceAll("-", "") }, { ...sucesso, oportunidade_id: oportunidadeId + "\n" },
    { ...sucesso, novo: null }, { ...sucesso, novo: "true" }, { ...sucesso, novo: 1 },
    { ...sucesso, ja_registrado: undefined }, { ...sucesso, ja_registrado: "false" }, { ...sucesso, ja_registrado: 0 },
  ])("retorno malformado %j vira falha genérica sem efeito lateral JS", async data => {
    fixture.rpc.mockResolvedValue({ data, error: null });
    expect(await registrarLeadVendasBot(lead, "novos")).toEqual(indisponivel);
    expect(await rotearLead(lead)).toEqual(indisponivel);
    semEfeitosJs();
  });
  it("erro SQL prevalece sobre corpo positivo e não revela diagnóstico", async () => {
    fixture.rpc.mockResolvedValue({ data: sucesso, error: { code: "42501", message: "fixture_interno" } });
    expect(await rotearLead(lead)).toEqual(indisponivel);
    semEfeitosJs();
  });
  it("exceção de RPC, envelope inválido ou falha do cliente DB não lança ao tool", async () => {
    fixture.rpc.mockRejectedValue(new Error("fixture_interno"));
    expect(await rotearLead(lead)).toEqual(indisponivel);
    fixture.rpc.mockResolvedValue(null);
    expect(await rotearLead(lead)).toEqual(indisponivel);
    fixture.db.mockImplementation(() => { throw new Error("fixture_configuração"); });
    expect(await registrarLeadVendasBot(lead, "novos")).toEqual(indisponivel);
    semEfeitosJs();
  });
});

describe("A1.1c preserva os caminhos anteriores de Peças/triagem", () => {
  it.each([["pecas", "pecas"], ["indefinido", "triagem"]])("%s mantém pré-consulta e encaminhamento existente", async (interesse, destino) => {
    fixture.from.mockImplementation((tabela: string) => {
      expect(tabela).toBe("clientes");
      return { select() { return this; }, eq() { return this; }, async maybeSingle() { return { data: { id: clienteId, anonimizado: false }, error: null }; } };
    });
    fixture.rpc.mockResolvedValue({ data: { ok: true, cotacao_id: outroId, ja_registrado: false }, error: null });
    expect(await rotearLead({ ...lead, interesse } as DadosLead)).toEqual({ ok: true, destino });
    expect(fixture.from).toHaveBeenCalledExactlyOnceWith("clientes");
    expect(fixture.rpc).toHaveBeenCalledExactlyOnceWith("encaminhar_lead_bot", {
      p_conversa_id: conversaId, p_cliente_id: clienteId, p_referencia: lead.referencia, p_destino: destino, p_resumo: lead.resumo,
    });
    expect(fixture.notificar).not.toHaveBeenCalled();
    expect(fixture.auditar).not.toHaveBeenCalled();
  });
});
