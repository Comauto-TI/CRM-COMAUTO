import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Usuario } from "@/lib/auth";
import { listarAtendimentos, registrarAtendimento, iniciarTriagem, type FiltrosFilaOficina } from "@/modulos/oficina/atendimentos";

const f = vi.hoisted(() => ({
  rpc: vi.fn(), dadosFila: null as unknown, clientes: [] as Record<string, unknown>[],
  consultas: [] as Array<{ tabela: string; colunas?: string; formas?: string[]; ordem?: string; crescente?: boolean; limite?: number }>,
  falhaCliente: false,
}));

vi.mock("@/lib/supabase/admin", () => ({ db: () => ({
  rpc: f.rpc,
  from(tabela: string) {
    if (tabela !== "clientes") throw new Error("Listagem física não autorizada no adaptador");
    const consulta: (typeof f.consultas)[number] = { tabela };
    f.consultas.push(consulta);
    const q = {
      select(colunas: string) { consulta.colunas = colunas; return q; },
      in(campo: string, formas: string[]) { expect(campo).toBe("telefone"); consulta.formas = formas; return q; },
      order(campo: string, opts: { ascending: boolean }) { consulta.ordem = campo; consulta.crescente = opts.ascending; return q; },
      async limit(limite: number) { consulta.limite = limite; if (f.falhaCliente) throw new Error("detalhe_interno"); return { data: f.clientes, error: null }; },
    };
    return q;
  },
}) }));

const ATOR = "a1000000-0000-4000-8000-000000000001";
const CLIENTE = "b1000000-0000-4000-8000-000000000001";
const ID = "c1000000-0000-4000-8000-000000000001";
const OUTRO = "c1000000-0000-4000-8000-000000000002";
const INSTANTE = "2026-11-11T12:00:00.000001+00:00";
const usuario = (patch: Partial<Usuario> = {}): Usuario => ({
  id: ATOR, email: "oficina@example.invalid", nome: "Consultor fictício", papel: "consultor_tecnico", setor: "oficina",
  unidade: "comauto", unidades: ["comauto"], ...patch,
});
const linha = (patch: Record<string, unknown> = {}) => ({
  id: ID, unidade: "comauto", descricao: "Ruído na suspensão", status: "novo", criadoEm: INSTANTE,
  clienteNome: "Cliente fictício", veiculo: null, responsavel: null, podeAssumir: true, ...patch,
});
const envelope = (patch: Record<string, unknown> = {}) => ({ ok: true, atendimentos: [linha()], total: 1, proximo: null, ...patch });
const dados = { id: ID, telefone: "5551998765432", descricao: "Ruído na suspensão", placa: null };

beforeEach(() => {
  vi.clearAllMocks();
  f.consultas = []; f.falhaCliente = false;
  f.clientes = [{ id: CLIENTE, telefone: "555198765432", anonimizado: false, criado_em: "2026-01-01" }];
  f.dadosFila = envelope();
  f.rpc.mockImplementation(async (nome: string) => {
    if (nome === "oficina_fila") return { data: f.dadosFila, error: null };
    if (nome === "oficina_registrar_atendimento") return { data: "criado", error: null };
    if (nome === "oficina_assumir_atendimento") return { data: true, error: null };
    throw new Error("RPC inesperada");
  });
});

describe("fila Oficina: ator e escopo final pela RPC", () => {
  it("envia somente ator/filtros e não consulta tabelas, unidades ou contadores gerais", async () => {
    const u = usuario({ id: ATOR.toUpperCase(), unidades: ["unidade_forjada"] });
    const filtros = { minhas: true, unidades: ["outra"], papel: "admin", responsavel: OUTRO } as FiltrosFilaOficina;
    const antes = structuredClone({ u, filtros });
    expect(await listarAtendimentos(u, filtros)).toEqual({ ok: true, atendimentos: [linha()], total: 1, proximo: null });
    expect(f.rpc).toHaveBeenCalledExactlyOnceWith("oficina_fila", {
      p_ator: ATOR, p_limite: 50, p_antes: null, p_antes_id: null, p_minhas: true,
    });
    expect(f.consultas).toEqual([]);
    expect({ u, filtros }).toEqual(antes);
  });
  it.each([
    ["admin", "administracao"], ["gerente", "oficina"], ["gerente", "administracao"],
    ["consultor_tecnico", "oficina"], ["recepcao", "oficina"], ["atendente", "oficina"],
  ] as const)("pré-filtro admite %s/%s, sem substituir a decisão do banco", async (papel, setor) => {
    expect((await listarAtendimentos(usuario({ papel, setor }))).ok).toBe(true);
    expect(f.rpc).toHaveBeenCalledTimes(1);
  });
  it.each([
    ["vendedor", "vendas"], ["pecas", "pecas"], ["financeiro", "administracao"],
    ["gerente", "vendas"], ["gerente", "pecas"],
  ] as const)("pré-filtro recusa %s/%s antes de qualquer leitura", async (papel, setor) => {
    expect(await listarAtendimentos(usuario({ papel, setor }))).toMatchObject({ ok: false, status: 403 });
    expect(f.rpc).not.toHaveBeenCalled(); expect(f.consultas).toEqual([]);
  });
  it.each([null, {}, { id: ATOR + "\n" }] as unknown[])("ator inválido não chega ao banco", async u => {
    expect(await listarAtendimentos(u as Usuario)).toMatchObject({ ok: false, status: 400 });
    expect(f.rpc).not.toHaveBeenCalled();
  });
  it("recusa atual do banco vence metadados previamente autorizados", async () => {
    f.rpc.mockResolvedValue({ data: { ok: false, codigo: "nao_encontrado", detalhe: "detalhe_interno" }, error: null });
    const r = await listarAtendimentos(usuario({ papel: "admin", setor: "administracao", unidades: ["todas"] }));
    expect(r).toMatchObject({ ok: false, status: 404 });
    expect(JSON.stringify(r)).not.toContain("detalhe_interno");
  });
});

describe("fila Oficina: cursor e paginação", () => {
  it.each([
    ["limite zero", { limite: 0 }], ["limite acima do contrato", { limite: 101 }],
    ["limite fracionário", { limite: 1.5 }], ["limite infinito", { limite: Infinity }],
    ["minhas string", { minhas: "true" }], ["minhas null", { minhas: null }],
    ["opções null", null], ["opções array", []],
    ["cursor incompleto", { antes: { criadoEm: INSTANTE } }],
    ["UUID com newline", { antes: { criadoEm: INSTANTE, id: ID + "\n" } }],
    ["calendário inexistente", { antes: { criadoEm: "2026-02-30T12:00:00Z", id: ID } }],
    ["hora 24", { antes: { criadoEm: "2026-11-11T24:00:00Z", id: ID } }],
    ["precisão excessiva", { antes: { criadoEm: "2026-11-11T12:00:00.0000001Z", id: ID } }],
  ] as Array<[string, unknown]>)("%s é recusado sem RPC", async (_nome, filtros) => {
    expect(await listarAtendimentos(usuario(), filtros as FiltrosFilaOficina)).toMatchObject({ ok: false, status: 400 });
    expect(f.rpc).not.toHaveBeenCalled();
  });
  it("preserva seis micros no cursor recebido e devolvido e normaliza UUID em cópia", async () => {
    const antes = { criadoEm: "2026-11-11T12:01:00.999999-03:00", id: OUTRO.toUpperCase() };
    f.dadosFila = envelope({ total: 3, proximo: { criadoEm: INSTANTE, id: ID.toUpperCase() } });
    const r = await listarAtendimentos(usuario(), { limite: 1, antes });
    expect(r).toMatchObject({ ok: true, proximo: { criadoEm: INSTANTE, id: ID } });
    expect(f.rpc).toHaveBeenCalledExactlyOnceWith("oficina_fila", {
      p_ator: ATOR, p_limite: 1, p_antes: antes.criadoEm, p_antes_id: OUTRO, p_minhas: false,
    });
    expect(antes.id).toBe(OUTRO.toUpperCase());
  });
  it.each(["2026-11-11T12:00:00Z", "2026-11-11T12:00:00+00:00", "2026-11-11T12:00:00.1Z"])("aceita timestamp PG %s sem reformatar", async criadoEm => {
    f.dadosFila = envelope({ atendimentos: [linha({ criadoEm })] });
    expect(await listarAtendimentos(usuario())).toMatchObject({ ok: true, atendimentos: [{ criadoEm }] });
  });
  it("não reordena instantes que diferem abaixo de milissegundo", async () => {
    f.dadosFila = envelope({ total: 2, atendimentos: [linha({ criadoEm: "2026-11-11T12:00:00.000002Z" }), linha({ id: OUTRO, criadoEm: "2026-11-11T12:00:00.000001Z" })] });
    const r = await listarAtendimentos(usuario());
    expect(r).toMatchObject({ ok: true, atendimentos: [{ id: ID, criadoEm: "2026-11-11T12:00:00.000002Z" }, { id: OUTRO, criadoEm: "2026-11-11T12:00:00.000001Z" }] });
  });
  it.each([
    ["cursor diferente por um micros", { total: 2, proximo: { id: ID, criadoEm: "2026-11-11T12:00:00.000002+00:00" } }, 1],
    ["ID final diferente", { total: 2, proximo: { id: OUTRO, criadoEm: INSTANTE } }, 1],
    ["página incompleta com próximo", { total: 3, proximo: { id: ID, criadoEm: INSTANTE } }, 2],
    ["próximo sem mais resultados", { total: 1, proximo: { id: ID, criadoEm: INSTANTE } }, 1],
    ["primeira página truncada sem próximo", { total: 2 }, 1],
  ] as Array<[string, Record<string, unknown>, number]>)("recusa %s", async (_nome, patch, limite) => {
    f.dadosFila = envelope(patch);
    expect(await listarAtendimentos(usuario(), { limite })).toMatchObject({ ok: false, status: 503 });
  });
  it("aceita o fim da página mantendo o total global anterior ao cursor", async () => {
    f.dadosFila = envelope({ total: 3, atendimentos: [] });
    expect(await listarAtendimentos(usuario(), { antes: { id: ID, criadoEm: INSTANTE } })).toEqual({ ok: true, atendimentos: [], total: 3, proximo: null });
  });
});

describe("fila Oficina: DTO mínimo e falhas", () => {
  it("mascara texto e descarta metadados sem modificar a resposta de origem", async () => {
    const original = envelope({ atendimentos: [linha({
      id: ID.toUpperCase(), descricao: "CPF 529.982.247-25 e cartão 4111 1111 1111 1111", clienteNome: "Nome 52998224725",
      status: "em_triagem", podeAssumir: false,
      veiculo: { placa: null, modelo: "Modelo 52998224725", segredo: "não_retornar" },
      responsavel: { id: ATOR.toUpperCase(), nome: "Equipe 52998224725", email: "não_retornar" },
      telefone: "não_retornar", clienteId: CLIENTE, conversaId: OUTRO,
    })], metadata: "não_retornar" });
    f.dadosFila = original; const copia = structuredClone(original);
    const r = await listarAtendimentos(usuario());
    expect(r).toMatchObject({ ok: true, atendimentos: [{ id: ID,
      descricao: "CPF [CPF removido] e cartão [cartão removido]", clienteNome: "Nome [CPF removido]",
      veiculo: { placa: null, modelo: "Modelo [CPF removido]" }, responsavel: { id: ATOR, nome: "Equipe [CPF removido]" },
    }] });
    expect(JSON.stringify(r)).not.toContain("não_retornar"); expect(JSON.stringify(r)).not.toContain(CLIENTE);
    expect(original).toEqual(copia);
  });
  it.each([
    ["UUID longo", { id: ID + "\n" }], ["status desconhecido", { status: "entregue" }],
    ["unidade vazia", { unidade: "" }], ["unidade com newline", { unidade: "comauto\n" }],
    ["timestamp inválido", { criadoEm: "2026-11-11T12:00:60Z" }], ["cliente inválido", { clienteNome: null }],
    ["veículo inválido", { veiculo: "placa" }], ["veículo incompleto", { veiculo: { placa: null } }],
    ["responsável inválido", { responsavel: { id: ATOR, nome: null } }],
    ["capacidade inválida", { podeAssumir: "true" }], ["triagem assumível", { status: "em_triagem" }],
    ["novo atribuído assumível", { responsavel: { id: ATOR, nome: "Equipe" } }],
  ] as Array<[string, Record<string, unknown>]>)("falha fechado em %s", async (_nome, patch) => {
    f.dadosFila = envelope({ atendimentos: [linha(patch)] });
    expect(await listarAtendimentos(usuario())).toMatchObject({ ok: false, status: 503 });
  });
  it.each([null, [], { ok: true, atendimentos: [], total: -1, proximo: null }, envelope({ total: Number.MAX_SAFE_INTEGER + 1 }), envelope({ total: 0 })])("recusa envelope inválido", async dado => {
    f.dadosFila = dado;
    expect(await listarAtendimentos(usuario())).toMatchObject({ ok: false, status: 503 });
  });
  it("recusa IDs duplicados mesmo com diferença de caixa", async () => {
    f.dadosFila = envelope({ total: 2, atendimentos: [linha(), linha({ id: ID.toUpperCase() })] });
    expect(await listarAtendimentos(usuario())).toMatchObject({ ok: false, status: 503 });
  });
  it.each([["invalido", 400], ["cursor_invalido", 400], ["nao_encontrado", 404], ["codigo_interno", 503]] as const)("mapeia código SQL %s sem detalhe cru", async (codigo, status) => {
    f.rpc.mockResolvedValue({ data: { ok: false, codigo, detalhe: "não_retornar" }, error: null });
    const r = await listarAtendimentos(usuario()); expect(r).toMatchObject({ ok: false, status }); expect(JSON.stringify(r)).not.toContain("não_retornar");
  });
  it.each(["PGRST202", "42P01", "42501"])("falha %s não vira fila vazia", async code => {
    f.rpc.mockResolvedValue({ data: null, error: { code, message: "não_retornar" } });
    expect(await listarAtendimentos(usuario())).toMatchObject({ ok: false, status: 503, pendente: code !== "42501" });
  });
  it("erro lançado não escapa do contrato", async () => {
    f.rpc.mockRejectedValue(new Error("não_retornar"));
    const r = await listarAtendimentos(usuario()); expect(r).toMatchObject({ ok: false, status: 503 }); expect(JSON.stringify(r)).not.toContain("não_retornar");
  });
});

describe("escritas Oficina: ficha canônica e resultados existentes", () => {
  it("busca a ficha pelas variantes e envia o telefone canônico, com ator da sessão", async () => {
    const entrada = { ...dados, id: ID.toUpperCase(), clienteId: OUTRO, ator: OUTRO, unidade: "forjada" };
    expect(await registrarAtendimento(usuario({ id: ATOR.toUpperCase() }), entrada)).toBe("criado");
    expect(f.consultas).toEqual([{ tabela: "clientes", colunas: "anonimizado, id, telefone, criado_em", formas: ["5551998765432", "555198765432"], ordem: "criado_em", crescente: true, limite: 1 }]);
    expect(f.rpc).toHaveBeenCalledExactlyOnceWith("oficina_registrar_atendimento", { p_id: ID, p_unidade: "comauto", p_ator: ATOR, p_telefone: "555198765432", p_placa: null, p_descricao: dados.descricao });
  });
  it.each(["anonimizado", "ausente", "malformado"])("ficha %s não gera RPC de criação", async caso => {
    f.clientes = caso === "ausente" ? [] : [{ id: caso === "malformado" ? CLIENTE + "\n" : CLIENTE, telefone: "555198765432", anonimizado: caso === "anonimizado" }];
    expect(await registrarAtendimento(usuario(), dados)).toBe("cliente"); expect(f.rpc).not.toHaveBeenCalled();
  });
  it.each([["vendedor", "vendas"], ["pecas", "pecas"], ["gerente", "vendas"]] as const)("%s/%s não consulta ficha nem escreve", async (papel, setor) => {
    expect(await registrarAtendimento(usuario({ papel, setor }), dados)).toBe("unidade");
    expect(await iniciarTriagem(usuario({ papel, setor }), ID)).toBe("indisponivel");
    expect(f.consultas).toEqual([]); expect(f.rpc).not.toHaveBeenCalled();
  });
  it("UUID de registro ou ator com newline não consulta ficha/RPC", async () => {
    expect(await registrarAtendimento(usuario(), { ...dados, id: ID + "\n" })).toBe("conflito");
    expect(await registrarAtendimento(usuario({ id: ATOR + "\n" }), dados)).toBe("unidade");
    expect(await iniciarTriagem(usuario(), ID + "\n")).toBe("indisponivel");
    expect(f.consultas).toEqual([]); expect(f.rpc).not.toHaveBeenCalled();
  });
  it.each(["criado", "unidade", "cliente", "veiculo", "conflito"] as const)("preserva resultado de registro %s", async data => {
    f.rpc.mockResolvedValue({ data, error: null }); expect(await registrarAtendimento(usuario(), dados)).toBe(data);
  });
  it("falha da busca de ficha não grava nem propaga erro interno", async () => {
    f.falhaCliente = true; expect(await registrarAtendimento(usuario(), dados)).toBe("erro"); expect(f.rpc).not.toHaveBeenCalled();
  });
  it.each([[true, "triagem"], [false, "indisponivel"], ["true", "erro_triagem"], [null, "erro_triagem"]] as const)("adapta resultado de triagem %s", async (data, resultado) => {
    f.rpc.mockResolvedValue({ data, error: null }); expect(await iniciarTriagem(usuario({ id: ATOR.toUpperCase() }), ID.toUpperCase())).toBe(resultado);
    expect(f.rpc).toHaveBeenCalledExactlyOnceWith("oficina_assumir_atendimento", { p_id: ID, p_ator: ATOR }); expect(f.consultas).toEqual([]);
  });
  it.each(["PGRST202", "42501", "throw"])("erros de escrita %s permanecem genéricos", async code => {
    if (code === "throw") f.rpc.mockRejectedValue(new Error("não_retornar")); else f.rpc.mockResolvedValue({ data: null, error: { code, message: "não_retornar" } });
    expect(await registrarAtendimento(usuario(), dados)).toBe(code === "PGRST202" ? "pendente" : "erro");
    expect(await iniciarTriagem(usuario(), ID)).toBe(code === "PGRST202" ? "pendente" : "erro_triagem");
  });
});
