import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Usuario } from "@/lib/auth";
import { ativarLembreteAniversario, lembretesInsistentes, listarAniversarios, marcarContatoAniversario } from "@/modulos/vendas/aniversarios-dados";

type Linha = Record<string, unknown>;
type Chamada = { tabela: string; contagem?: string; ordens: string[]; range?: [number, number]; lotes: number[] };
const fixture = vi.hoisted(() => ({
  from: vi.fn(), rpc: vi.fn(), auditar: vi.fn(),
  tabelas: {} as Record<string, Linha[]>, chamadas: [] as Chamada[], teto: 1000,
  erroTabela: null as string | null, semCount: null as string | null,
  erroPagina: null as string | null, mutacoes: [] as string[],
}));
vi.mock("@/lib/supabase/admin", () => ({ db: () => ({ from: fixture.from, rpc: fixture.rpc }) }));
vi.mock("@/lib/audit", () => ({ auditar: fixture.auditar }));
vi.mock("@/lib/usuarios", () => ({ nucleoAplicado: async () => true }));

const uuid = (n: number) => `20000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const hoje = "2026-11-11";
const admin: Usuario = { id: uuid(1), nome: "Admin fictício", email: "admin@example.test", papel: "admin", setor: "administracao", unidade: "comauto", unidades: ["comauto"] };
const vendedor: Usuario = { ...admin, id: uuid(2), email: "vendedor@example.test", papel: "vendedor", setor: "vendas" };
const gerente: Usuario = { ...admin, id: uuid(3), papel: "gerente", setor: "vendas", unidades: ["comauto", "santaluzia"] };

function cliente(n = 101, campos: Linha = {}) {
  const c = { id: uuid(n), nome: `Cliente fictício ${n}`, telefone: "5511900000001", data_nascimento: "1990-11-11", vendedor_id: vendedor.id, unidade_origem: "comauto", anonimizado: false, ...campos };
  fixture.tabelas.clientes.push(c);
  return c;
}
function lembrar(c: Linha, campos: Linha = {}) {
  const l = { id: uuid(100000 + fixture.tabelas.lembretes.length), cliente_id: c.id, usuario_id: admin.id, unidade: "comauto", tipo: "aniversario", data_alvo: hoje, insistente: true, concluido_em: null, ...campos };
  fixture.tabelas.lembretes.push(l);
  return l;
}
function mensagem(c: Linha, campos: Linha = {}) {
  fixture.tabelas.mensagens.push({ id: uuid(200000 + fixture.tabelas.mensagens.length), cliente_id: c.id, direcao: "saida", autor: "atendente", status: "enviada", criado_em: "2026-11-11T03:00:00.000Z", ...campos });
}
function atividade(c: Linha, campos: Linha = {}) {
  const op = { id: uuid(300000 + fixture.tabelas.vendas_oportunidades.length), cliente_id: c.id, unidade: "comauto", vendedor_id: vendedor.id };
  fixture.tabelas.vendas_oportunidades.push(op);
  fixture.tabelas.vendas_atividades.push({ id: uuid(400000 + fixture.tabelas.vendas_atividades.length), oportunidade_id: op.id, tipo: "ligacao", ator: vendedor.email, criado_em: "2026-11-11T03:00:00.000Z", ...campos });
}
function contato(c: Linha, data = hoje) {
  fixture.tabelas.aniversarios_contatos.push({ cliente_id: c.id, data_alvo: data, ator_id: admin.id, unidade: "comauto", criado_em: "2026-11-11T12:00:00.000Z" });
}

function comparar(a: unknown, b: unknown) {
  const numero = (x: unknown) => typeof x === "string" && /T\d\d:/.test(x) ? Date.parse(x) : x;
  const x = numero(a) as string | number, y = numero(b) as string | number;
  return x < y ? -1 : x > y ? 1 : 0;
}
function consulta(tabela: string) {
  expect(Object.hasOwn(fixture.tabelas, tabela), `Tabela inesperada: ${tabela}`).toBe(true);
  const chamada: Chamada = { tabela, ordens: [], lotes: [] };
  fixture.chamadas.push(chamada);
  const filtros: ((r: Linha) => boolean)[] = [];
  const ordens: { coluna: string; asc: boolean }[] = [];
  let limite = Infinity;
  let inicio = 0;
  let fim = Infinity;
  let coluna = "";
  const valor = (r: Linha, c: string) => r[c] ?? null;
  const executar = async () => {
    if (fixture.erroTabela === tabela || (fixture.erroPagina === tabela && inicio > 0)) return { data: null, count: null, error: { code: "fixture_indisponivel" } };
    let linhas = fixture.tabelas[tabela].filter(r => filtros.every(f => f(r)));
    linhas = [...linhas].sort((a, b) => {
      for (const ordem of ordens) {
        const resultado = comparar(valor(a, ordem.coluna), valor(b, ordem.coluna));
        if (resultado) return ordem.asc ? resultado : -resultado;
      }
      return 0;
    });
    const count = fixture.semCount === tabela ? null : linhas.length;
    const tamanho = Math.min(limite, fixture.teto, fim - inicio + 1);
    const data = linhas.slice(inicio, inicio + tamanho).map(r => {
      const copia = structuredClone(r);
      if (tabela === "lembretes" && /clientes\(/.test(coluna)) {
        const c = fixture.tabelas.clientes.find(c => c.id === r.cliente_id) ?? null;
        copia.cliente = c ? structuredClone(c) : null;
      }
      return copia;
    });
    return { data, count, error: null };
  };
  return {
    select(c: string, opcoes?: { count?: string }) { coluna = c; chamada.contagem = opcoes?.count; return this; },
    eq(c: string, v: unknown) { filtros.push(r => valor(r, c) === v); return this; },
    neq(c: string, v: unknown) { filtros.push(r => valor(r, c) !== null && valor(r, c) !== v); return this; },
    in(c: string, vs: unknown[]) { chamada.lotes.push(vs.length); filtros.push(r => vs.includes(valor(r, c))); return this; },
    is(c: string, v: unknown) { filtros.push(r => valor(r, c) === v); return this; },
    not(c: string, op: string, v: unknown) {
      if (op === "is") filtros.push(r => valor(r, c) !== v);
      else if (op === "in") {
        const lista = Array.isArray(v) ? v : String(v).replace(/^\(|\)$/g, "").split(",");
        filtros.push(r => valor(r, c) !== null && !lista.includes(valor(r, c)));
      } else throw new Error("Operador não implementado na fixture: " + op);
      return this;
    },
    gte(c: string, v: unknown) { filtros.push(r => comparar(valor(r, c), v) >= 0); return this; },
    lte(c: string, v: unknown) { filtros.push(r => comparar(valor(r, c), v) <= 0); return this; },
    gt(c: string, v: unknown) { filtros.push(r => comparar(valor(r, c), v) > 0); return this; },
    lt(c: string, v: unknown) { filtros.push(r => comparar(valor(r, c), v) < 0); return this; },
    order(c: string, opcoes?: { ascending?: boolean }) {
      if (tabela === "usuarios") expect(c, "PK de usuarios é user_id, não id").not.toBe("id");
      ordens.push({ coluna: c, asc: opcoes?.ascending !== false }); chamada.ordens.push(c); return this;
    },
    range(de: number, ate: number) { inicio = de; fim = ate; chamada.range = [de, ate]; return this; },
    limit(n: number) { limite = n; return this; },
    async maybeSingle() { const r = await executar(); return { ...r, data: r.data?.[0] ?? null }; },
    async single() { const r = await executar(); return { ...r, data: r.data?.[0] ?? null }; },
    insert() { fixture.mutacoes.push(tabela + ".insert"); throw new Error("A mutação deve ficar na RPC"); },
    update() { fixture.mutacoes.push(tabela + ".update"); throw new Error("A mutação deve ficar na RPC"); },
    then(resolver: (r: Awaited<ReturnType<typeof executar>>) => unknown, rejeitar?: (erro: unknown) => unknown) { return executar().then(resolver, rejeitar); },
  };
}

beforeEach(() => {
  fixture.tabelas = { clientes: [], usuarios: [
    { user_id: vendedor.id, nome: "Vendedor fictício", unidade: "comauto", ativo: true, papel: "vendedor", setor: "vendas" },
    { user_id: admin.id, nome: admin.nome, unidade: "comauto", ativo: true, papel: "admin", setor: "administracao" },
  ], lembretes: [], mensagens: [], vendas_oportunidades: [], vendas_atividades: [], aniversarios_contatos: [] };
  fixture.chamadas = []; fixture.mutacoes = []; fixture.teto = 1000;
  fixture.erroTabela = null; fixture.semCount = null; fixture.erroPagina = null;
  fixture.from.mockReset().mockImplementation(consulta);
  fixture.rpc.mockReset().mockResolvedValue({ data: { ok: true }, error: null });
  fixture.auditar.mockReset();
});

describe("F5 contato verificável e data local", () => {
  it.each(["nota", "proposta"])("atividade %s não prova contato", async tipo => {
    const c = cliente(); atividade(c, { tipo });
    expect((await listarAniversarios(admin, hoje))[0].estado).toBe("hoje");
  });
  it.each(["ligacao", "whatsapp", "visita", "test_drive", "email"])("atividade manual %s prova contato", async tipo => {
    const c = cliente(); atividade(c, { tipo });
    expect((await listarAniversarios(admin, hoje))[0].estado).toBe("feito");
  });
  it.each(["assistente", "sistema", "bot"])("atividade de %s não prova contato", async ator => {
    const c = cliente(); atividade(c, { ator });
    expect((await listarAniversarios(admin, hoje))[0].estado).toBe("hoje");
  });
  it.each(["falhou", "bloqueada", "recebida"])("mensagem %s não prova contato", async status => {
    const c = cliente(); mensagem(c, { status });
    expect((await listarAniversarios(admin, hoje))[0].estado).toBe("hoje");
  });
  it.each(["enviada", "entregue", "lida"])("mensagem humana %s prova contato", async status => {
    const c = cliente(); mensagem(c, { status });
    expect((await listarAniversarios(admin, hoje))[0].estado).toBe("feito");
  });
  it("mensagem de bot e lembrete concluído não substituem contato explícito", async () => {
    const c = cliente(); mensagem(c, { autor: "bot" }); lembrar(c, { concluido_em: "2026-11-11T12:00:00Z" });
    expect((await listarAniversarios(admin, hoje))[0].estado).toBe("hoje");
  });
  it("não conta 01Z do dia11 porque ainda era dia10 no offset -03", async () => {
    const c = cliente(); mensagem(c, { criado_em: "2026-11-11T01:00:00.000Z" });
    atividade(c, { criado_em: "2026-11-11T02:59:59.999Z" });
    expect((await listarAniversarios(admin, hoje, 7, "-03:00"))[0].estado).toBe("hoje");
    mensagem(c, { criado_em: "2026-11-11T03:00:00.000Z" });
    expect((await listarAniversarios(admin, hoje, 7, "-03:00"))[0].estado).toBe("feito");
  });
  it("respeita offset configurável em vez de fixar meia-noite UTC ou -03", async () => {
    const c = cliente(); mensagem(c, { criado_em: "2026-11-11T03:30:00.000Z" });
    expect((await listarAniversarios(admin, hoje, 7, "-04:00"))[0].estado).toBe("hoje");
  });
  it("contato explícito vale somente para a data de aniversário correspondente", async () => {
    const c = cliente(); contato(c, "2025-11-11");
    expect((await listarAniversarios(admin, hoje))[0].estado).toBe("hoje");
    contato(c);
    expect((await listarAniversarios(admin, hoje))[0].estado).toBe("feito");
  });
});

describe("F5 paginação e escopo", () => {
  it("mantém os 1001 clientes e auxiliares acessíveis, com lotes de até100", async () => {
    for (let i = 0; i < 1001; i++) {
      const dono = uuid(10000 + i);
      fixture.tabelas.usuarios.push({ user_id: dono, nome: `Vendedor ${i}`, unidade: "comauto", ativo: true });
      const c = cliente(1000 + i, { vendedor_id: dono }); lembrar(c);
      if (i < 334) contato(c);
      else if (i < 668) mensagem(c);
      else atividade(c);
    }
    const lista = await listarAniversarios(admin, hoje);
    expect(lista).toHaveLength(1001);
    expect(new Set(lista.map(c => c.clienteId)).size).toBe(1001);
    expect(lista.every(c => c.estado === "feito" && c.lembreteAtivo)).toBe(true);
    expect(lista.find(c => c.clienteId === uuid(2000))?.vendedor).toBe("Vendedor 1000");
    expect(fixture.chamadas.flatMap(c => c.lotes).every(n => n <= 100)).toBe(true);
    const paginas = fixture.chamadas.filter(c => c.tabela === "clientes" && c.range);
    expect(paginas.every(c => c.contagem === "exact" && c.ordens.includes("id"))).toBe(true);
  });
  it("avança pelo tamanho retornado quando a API limita a página abaixo de500", async () => {
    fixture.teto = 137;
    for (let i = 0; i < 1001; i++) cliente(1000 + i);
    expect(await listarAniversarios(admin, hoje)).toHaveLength(1001);
    expect(fixture.chamadas.filter(c => c.tabela === "clientes" && c.range).map(c => c.range![0])).toEqual([0, 137, 274, 411, 548, 685, 822, 959]);
  });
  it("pagina 1001 mensagens válidas e 1001 atividades manuais da mesma oportunidade", async () => {
    const c = cliente(101);
    cliente(102, { data_nascimento: "1990-11-04" }); // início agregado local em04/11
    for (let i = 0; i < 1001; i++) mensagem(c, {
      status: "enviada", criado_em: i === 1000 ? "2026-11-11T03:00:00.000Z" : "2026-11-10T12:00:00.000Z",
    });
    expect((await listarAniversarios(admin, hoje)).find(x => x.clienteId === c.id)?.estado).toBe("feito");
    expect(fixture.chamadas.filter(x => x.tabela === "mensagens" && x.range).map(x => x.range![0])).toEqual([0, 500, 1000]);
    fixture.tabelas.mensagens = [];
    fixture.chamadas = [];
    const oportunidade = uuid(300000);
    fixture.tabelas.vendas_oportunidades.push({ id: oportunidade, cliente_id: c.id, unidade: "comauto", vendedor_id: vendedor.id });
    fixture.tabelas.vendas_atividades = Array.from({ length: 1001 }, (_, i) => ({
      id: uuid(400000 + i), oportunidade_id: oportunidade, tipo: "ligacao", ator: vendedor.email,
      criado_em: i === 1000 ? "2026-11-11T03:00:00.000Z" : "2026-11-10T12:00:00.000Z",
    }));
    expect((await listarAniversarios(admin, hoje)).find(x => x.clienteId === c.id)?.estado).toBe("feito");
    expect(fixture.chamadas.filter(x => x.tabela === "vendas_atividades" && x.range).map(x => x.range![0])).toEqual([0, 500, 1000]);
  });
  it("vendedor vê a própria carteira; gerente usa unidade do dono ou origem, admin vê todas", async () => {
    const fora = uuid(20); fixture.tabelas.usuarios.push({ user_id: fora, nome: "Outra unidade", unidade: "motomecanica" });
    cliente(101);
    cliente(102, { vendedor_id: fora, unidade_origem: "comauto" });
    cliente(103, { vendedor_id: null, unidade_origem: "santaluzia" });
    cliente(104, { vendedor_id: null, unidade_origem: "motomecanica" });
    cliente(105, { anonimizado: true });
    expect((await listarAniversarios(vendedor, hoje)).map(c => c.clienteId)).toEqual([uuid(101)]);
    expect((await listarAniversarios(gerente, hoje)).map(c => c.clienteId).sort()).toEqual([uuid(101), uuid(103)]);
    expect(await listarAniversarios(admin, hoje)).toHaveLength(4);
  });
  it.each(["clientes", "usuarios", "lembretes", "mensagens", "vendas_oportunidades", "vendas_atividades", "aniversarios_contatos"])("erro de %s é falha, não lista vazia", async tabela => {
    const c = cliente(); atividade(c); fixture.erroTabela = tabela;
    await expect(listarAniversarios(admin, hoje)).rejects.toThrow();
  });
  it("count ausente e erro em página posterior não produzem resultado parcial", async () => {
    cliente(); fixture.semCount = "clientes";
    await expect(listarAniversarios(admin, hoje)).rejects.toThrow();
    fixture.semCount = null; fixture.erroPagina = "clientes"; fixture.teto = 1; cliente(102);
    await expect(listarAniversarios(admin, hoje)).rejects.toThrow();
  });
});

describe("F5 lembrete insistente antigo", () => {
  it("retorna todos os 1001 lembretes antigos, com dataAlvo preservada", async () => {
    for (let i = 0; i < 1001; i++) lembrar(cliente(1000 + i, { data_nascimento: "1990-11-03" }), { data_alvo: "2026-11-03" });
    const lista = await lembretesInsistentes(admin, hoje);
    expect(lista).toHaveLength(1001);
    expect(lista.every(l => l.dataAlvo === "2026-11-03" && l.dias === -8)).toBe(true);
  });
  it("admin vê suas pendências em qualquer unidade, excluindo outro usuário, anonimizado e concluído", async () => {
    lembrar(cliente(101));
    lembrar(cliente(102), { usuario_id: vendedor.id });
    lembrar(cliente(103), { unidade: "motomecanica" });
    lembrar(cliente(104, { anonimizado: true }));
    lembrar(cliente(105), { concluido_em: "2026-11-10T12:00:00Z" });
    lembrar(cliente(106, { data_nascimento: "1990-11-19" }), { data_alvo: "2026-11-19" });
    expect((await lembretesInsistentes(admin, hoje)).map(l => l.clienteId)).toEqual([uuid(101), uuid(103)]);
    fixture.tabelas.lembretes = []; const alheio = cliente(107, { vendedor_id: admin.id }); lembrar(alheio, { usuario_id: vendedor.id });
    expect(await lembretesInsistentes(vendedor, hoje)).toEqual([]);
  });
  it.each([vendedor, { ...gerente, unidades: ["comauto"] }])("perfil $papel mantém o filtro de unidade", async u => {
    lembrar(cliente(101), { usuario_id: u.id });
    lembrar(cliente(102), { usuario_id: u.id, unidade: "motomecanica" });
    expect((await lembretesInsistentes(u, hoje)).map(l => l.clienteId)).toEqual([uuid(101)]);
    if (u.papel === "gerente") {
      expect((await lembretesInsistentes({ ...u, unidades: ["comauto", "motomecanica"] }, hoje)).map(l => l.clienteId)).toEqual([uuid(101), uuid(102)]);
    }
  });
  it.each(["1990-12-03", "1990-02-30", null])("nascimento corrigido para %s oculta popup antigo sem modificar o registro", async nascimento => {
    const c = cliente(101, { data_nascimento: "1990-11-03" });
    const lembrete = lembrar(c, { data_alvo: "2026-11-03" });
    const original = structuredClone(lembrete);
    expect(await lembretesInsistentes(admin, hoje)).toHaveLength(1);
    fixture.tabelas.clientes[0].data_nascimento = nascimento;
    expect(await lembretesInsistentes(admin, hoje)).toEqual([]);
    expect(fixture.tabelas.lembretes).toEqual([original]);
    expect(fixture.mutacoes).toEqual([]);
    expect(fixture.rpc).not.toHaveBeenCalled();
  });
  it("erro de leitura não se disfarça de nenhum lembrete pendente", async () => {
    lembrar(cliente()); fixture.erroTabela = "lembretes";
    await expect(lembretesInsistentes(admin, hoje)).rejects.toThrow();
    fixture.erroTabela = null; fixture.semCount = "lembretes";
    await expect(lembretesInsistentes(admin, hoje)).rejects.toThrow();
  });
});

describe("F5 mutações atômicas", () => {
  it("marca contato da data antiga exata pelo RPC, sem notas ou auditoria separadas", async () => {
    const c = cliente(101, { data_nascimento: "1990-11-03" });
    expect((await marcarContatoAniversario(admin, c.id, hoje, "2026-11-03")).ok).toBe(true);
    expect(fixture.rpc).toHaveBeenCalledExactlyOnceWith("registrar_contato_aniversario", {
      p_cliente_id: c.id, p_ator: admin.id, p_unidades: admin.unidades, p_data: "2026-11-03", p_autor: admin.email,
    });
    expect(fixture.mutacoes).toEqual([]); expect(fixture.auditar).not.toHaveBeenCalled();
  });
  it("data implícita exige janela ±7; alvo antigo explícito continua aceito", async () => {
    const c = cliente(101, { data_nascimento: "1990-11-03" });
    expect((await marcarContatoAniversario(admin, c.id, hoje)).ok).toBe(false);
    expect(fixture.rpc).not.toHaveBeenCalled();
    expect((await marcarContatoAniversario(admin, c.id, hoje, "2026-11-03")).ok).toBe(true);
    expect(fixture.rpc).toHaveBeenCalledExactlyOnceWith("registrar_contato_aniversario", expect.objectContaining({ p_data: "2026-11-03" }));
  });
  it("ativação usa somente RPC e a data do aniversário dentro da janela", async () => {
    const c = cliente(101, { data_nascimento: "1990-11-18" });
    expect((await ativarLembreteAniversario(admin, c.id, hoje)).ok).toBe(true);
    expect(fixture.rpc).toHaveBeenCalledExactlyOnceWith("ativar_lembrete_aniversario", {
      p_cliente_id: c.id, p_ator: admin.id, p_unidades: admin.unidades, p_data: "2026-11-18",
    });
    expect(fixture.mutacoes).toEqual([]); expect(fixture.auditar).not.toHaveBeenCalled();
  });
  it("aceita contato no limite futuro de7dias e aniversário de29/02 em ano não bissexto", async () => {
    const futuro = cliente(101, { data_nascimento: "1990-11-18" });
    expect((await marcarContatoAniversario(admin, futuro.id, hoje, "2026-11-18")).ok).toBe(true);
    expect(fixture.rpc).toHaveBeenLastCalledWith("registrar_contato_aniversario", expect.objectContaining({ p_data: "2026-11-18" }));
    const bissexto = cliente(102, { data_nascimento: "2000-02-29" });
    expect((await marcarContatoAniversario(admin, bissexto.id, "2027-03-01", "2027-02-28")).ok).toBe(true);
    expect(fixture.rpc).toHaveBeenLastCalledWith("registrar_contato_aniversario", expect.objectContaining({ p_data: "2027-02-28" }));
  });
  it.each([
    ["1990-11-11", "2026-11-10"], ["1990-11-19", "2026-11-19"],
    ["1990-02-28", "2026-02-30"], ["1990-11-11", "2026-13-11"], ["1990-02-30", "2026-03-02"],
  ])("recusa data inválida ou não correspondente ao aniversário (%s/%s)", async (nascimento, alvo) => {
    const c = cliente(101, { data_nascimento: nascimento });
    expect((await marcarContatoAniversario(admin, c.id, hoje, alvo)).ok).toBe(false);
    expect(fixture.rpc).not.toHaveBeenCalled();
  });
  it("não ativa lembrete distante nem marca outra carteira", async () => {
    const c = cliente(101, { data_nascimento: "1990-11-03" });
    expect((await ativarLembreteAniversario(admin, c.id, hoje)).ok).toBe(false);
    expect((await marcarContatoAniversario({ ...vendedor, id: uuid(80) }, c.id, hoje, "2026-11-03")).ok).toBe(false);
    expect(fixture.rpc).not.toHaveBeenCalled();
  });
  it.each(["registrar", "ativar"])("%s não confirma JSON negativo, erro SQL nem throw", async operacao => {
    const c = cliente();
    const chamar = () => operacao === "registrar" ? marcarContatoAniversario(admin, c.id, hoje) : ativarLembreteAniversario(admin, c.id, hoje);
    for (const retorno of [{ data: { ok: false }, error: null }, { data: null, error: { code: "fixture_sql" } }, { data: {}, error: null }]) {
      fixture.rpc.mockResolvedValue(retorno);
      expect((await chamar()).ok).toBe(false);
    }
    fixture.rpc.mockRejectedValue(new Error("fixture_conexao"));
    expect((await chamar()).ok).toBe(false);
    expect(fixture.mutacoes).toEqual([]); expect(fixture.auditar).not.toHaveBeenCalled();
  });
});
