import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Usuario } from "@/lib/auth";
import { criarMembro, definirAtivo, gerarSenhaProvisoria, redefinirSenha } from "@/lib/equipe";
import { criarMembroAction, definirAtivoAction, redefinirSenhaAction, salvarEquipe } from "@/app/painel/configuracoes/actions";

type Linha = Record<string, unknown>;
type AuthFicticio = {
  id: string;
  email: string;
  password: string;
  user_metadata: Record<string, unknown>;
  app_metadata: Record<string, unknown>;
};
type NovoAuth = {
  email: string;
  password: string;
  user_metadata?: Record<string, unknown>;
  app_metadata?: Record<string, unknown>;
};
type ResultadoConsulta = { data: Linha[] | null; error: { code: string } | null };

const fixture = vi.hoisted(() => ({
  from: vi.fn(), listUsers: vi.fn(), createUser: vi.fn(), getUserById: vi.fn(),
  updateUserById: vi.fn(), deleteUser: vi.fn(), auditar: vi.fn(), exigirAcesso: vi.fn(),
  revalidatePath: vi.fn(), tabelaUsuarios: vi.fn(),
  tabelas: {} as Record<string, Linha[]>, authUsers: [] as AuthFicticio[],
  inclusoes: [] as { tabela: string; dados: Linha }[],
  atualizacoes: [] as { tabela: string; dados: Linha }[],
  falhasInsert: 0, erroBuscaPagina: null as number | null, erroCriar: false, erroAtualizar: false, erroObter: false,
  chamadasRandom: 0,
}));

vi.mock("node:crypto", async importarOriginal => {
  const original = await importarOriginal<typeof import("node:crypto")>();
  return { ...original, randomInt(limite: number) {
    fixture.chamadasRandom++;
    return original.randomInt(limite);
  } };
});
vi.mock("@/lib/supabase/admin", () => ({ db: () => ({
  from: fixture.from,
  auth: { admin: {
    listUsers: fixture.listUsers, createUser: fixture.createUser, getUserById: fixture.getUserById,
    updateUserById: fixture.updateUserById, deleteUser: fixture.deleteUser,
  } },
}) }));
vi.mock("@/lib/auth", () => ({ exigirAcesso: fixture.exigirAcesso }));
vi.mock("@/lib/audit", () => ({ auditar: fixture.auditar }));
vi.mock("next/cache", () => ({ revalidatePath: fixture.revalidatePath }));
vi.mock("@/lib/usuarios", () => ({ tabelaUsuarios: fixture.tabelaUsuarios }));
vi.mock("@/lib/config", () => ({ getConfig: vi.fn(), invalidarConfig: vi.fn() }));

const uuid = (n: number) => `10000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const admin: Usuario = {
  id: "a1111111-b222-4c33-8d44-e55555555555", nome: "Administrador fictício", email: "admin@example.test", papel: "admin",
  setor: "administracao", unidade: "comauto", unidades: ["comauto"],
};
const dados = { nome: "Membro fictício", email: "membro@example.test", papel: "pecas", setor: "pecas", unidade: "comauto" };

function consulta(tabela: string) {
  expect(Object.hasOwn(fixture.tabelas, tabela), `Tabela inesperada: ${tabela}`).toBe(true);
  const filtros: ((linha: Linha) => boolean)[] = [];
  let operacao = "select";
  let valores: Linha;
  let resultado: ResultadoConsulta | undefined;
  const executar = (): ResultadoConsulta => {
    if (resultado) return resultado;
    if (operacao === "insert") {
      fixture.inclusoes.push({ tabela, dados: structuredClone(valores) });
      if (fixture.falhasInsert > 0) {
        fixture.falhasInsert--;
        return resultado = { data: null, error: { code: "fixture_insert_indisponivel" } };
      }
      if (fixture.tabelas[tabela].some(linha => linha.user_id === valores.user_id)) {
        return resultado = { data: null, error: { code: "23505" } };
      }
      expect(fixture.authUsers.some(usuario => usuario.id === valores.user_id), "FK Auth da inclusão local").toBe(true);
      fixture.tabelas[tabela].push({ consentimento_alertas_em: null, ...structuredClone(valores) });
      return resultado = { data: [structuredClone(valores)], error: null };
    }
    const linhas = fixture.tabelas[tabela].filter(linha => filtros.every(filtro => filtro(linha)));
    if (operacao === "update") {
      fixture.atualizacoes.push({ tabela, dados: structuredClone(valores) });
      for (const linha of linhas) Object.assign(linha, structuredClone(valores));
    }
    return resultado = { data: structuredClone(linhas), error: null };
  };
  return {
    select() { return this; },
    eq(coluna: string, valor: unknown) { filtros.push(linha => linha[coluna] === valor); return this; },
    insert(d: Linha) { operacao = "insert"; valores = d; return this; },
    update(d: Linha) { operacao = "update"; valores = d; return this; },
    async maybeSingle() { const r = executar(); return { ...r, data: r.data?.[0] ?? null }; },
    async single() { const r = executar(); return { ...r, data: r.data?.[0] ?? null }; },
    then(resolver: (r: ResultadoConsulta) => unknown, rejeitar?: (erro: unknown) => unknown) {
      return Promise.resolve(executar()).then(resolver, rejeitar);
    },
  };
}

function conta(opcoes: Partial<AuthFicticio> = {}) {
  const usuario: AuthFicticio = {
    id: uuid(10 + fixture.authUsers.length), email: dados.email, password: "senha-ficticia-existente",
    user_metadata: {}, app_metadata: {}, ...opcoes,
  };
  fixture.authUsers.push(usuario);
  return usuario;
}
function membro(usuario: AuthFicticio) {
  fixture.tabelas.usuarios.push({
    user_id: usuario.id, nome: dados.nome, papel: "pecas", setor: "pecas", unidade: "comauto",
    ativo: true, consentimento_alertas_em: null,
  });
}
function form(opcoes: Record<string, string | null | undefined> = {}) {
  const f = new FormData();
  for (const [chave, valor] of Object.entries({ ...dados, ...opcoes })) if (typeof valor === "string") f.set(chave, valor);
  return f;
}
function semMutacaoAuth() {
  expect(fixture.createUser).not.toHaveBeenCalled();
  expect(fixture.updateUserById).not.toHaveBeenCalled();
  expect(fixture.deleteUser).not.toHaveBeenCalled();
}

beforeEach(() => {
  vi.clearAllMocks();
  fixture.falhasInsert = 0;
  fixture.erroBuscaPagina = null;
  fixture.erroCriar = false;
  fixture.erroAtualizar = false;
  fixture.erroObter = false;
  fixture.chamadasRandom = 0;
  fixture.inclusoes = [];
  fixture.atualizacoes = [];
  fixture.authUsers = [{ id: admin.id, email: admin.email, password: "admin-ficticio", app_metadata: {}, user_metadata: {} }];
  fixture.tabelas = {
    unidades: [{ chave: "comauto", ativa: true }],
    usuarios: [{ user_id: admin.id, nome: admin.nome, papel: "admin", setor: "administracao", unidade: "comauto", ativo: true, consentimento_alertas_em: null }],
  };
  fixture.from.mockImplementation(consulta);
  fixture.exigirAcesso.mockReset().mockResolvedValue(admin);
  fixture.tabelaUsuarios.mockReset().mockResolvedValue("usuarios");
  fixture.auditar.mockReset().mockResolvedValue(undefined);
  fixture.listUsers.mockReset().mockImplementation(async ({ page, perPage }: { page: number; perPage: number }) => {
    if (page === fixture.erroBuscaPagina) return { data: { users: [] }, error: { code: "fixture_busca_indisponivel" } };
    return { data: { users: structuredClone(fixture.authUsers.slice((page - 1) * perPage, page * perPage)) }, error: null };
  });
  fixture.createUser.mockReset().mockImplementation(async (d: NovoAuth) => {
    if (fixture.erroCriar) return { data: { user: null }, error: { code: "fixture_create_indisponivel" } };
    if (fixture.authUsers.some(usuario => usuario.email.toLowerCase() === d.email.toLowerCase())) {
      return { data: { user: null }, error: { code: "email_exists" } };
    }
    const usuario = conta({
      id: uuid(5000 + fixture.authUsers.length), email: d.email, password: d.password,
      app_metadata: structuredClone(d.app_metadata ?? {}), user_metadata: structuredClone(d.user_metadata ?? {}),
    });
    return { data: { user: structuredClone(usuario) }, error: null };
  });
  fixture.getUserById.mockReset().mockImplementation(async (id: string) => ({
    data: { user: fixture.erroObter ? null : structuredClone(fixture.authUsers.find(usuario => usuario.id === id) ?? null) },
    error: fixture.erroObter ? { code: "fixture_get_indisponivel" } : null,
  }));
  fixture.updateUserById.mockReset().mockImplementation(async (id: string, d: { password?: string }) => {
    if (fixture.erroAtualizar) return { data: { user: null }, error: { code: "fixture_update_indisponivel" } };
    const usuario = fixture.authUsers.find(u => u.id === id);
    expect(usuario).toBeDefined();
    if (!usuario) throw new Error("Usuário inexistente na fixture");
    if (d.password !== undefined) usuario.password = d.password;
    return { data: { user: structuredClone(usuario) }, error: null };
  });
});

describe("origem confiável e senha da equipe", () => {
  it("cria conta controlada com origem em app_metadata e somente nome em user_metadata", async () => {
    const r = await criarMembro(admin, { ...dados, email: "  MEMBRO@example.test  " });
    expect(r.ok).toBe(true);
    if (!r.ok) throw new Error(r.motivo);
    expect(r.senhaProvisoria).toEqual(expect.any(String));
    expect(fixture.createUser).toHaveBeenCalledWith(expect.objectContaining({
      email: dados.email, password: r.senhaProvisoria,
      app_metadata: { origem: "plataforma-comauto" }, user_metadata: { nome: dados.nome },
    }));
    const criado = fixture.authUsers.find(u => u.email === dados.email)!;
    expect(criado.user_metadata).not.toHaveProperty("origem");
    expect(criado.password).toBe(r.senhaProvisoria);
    expect(fixture.tabelas.usuarios).toContainEqual(expect.objectContaining({ user_id: criado.id, ativo: true }));
    expect(JSON.stringify(fixture.auditar.mock.calls)).not.toContain(r.senhaProvisoria!);
  });

  it.each([
    [{}, {}],
    [{ origem: "plataforma-comauto" }, {}],
    [{ origem: "plataforma-comauto" }, { origem: "processo-vendas-teste" }],
  ])("vincula conta externa sem trocar senha, inclusive user_metadata forjado (%j / %j)", async (user_metadata, app_metadata) => {
    const externo = conta({ user_metadata, app_metadata });
    const antes = structuredClone(externo);
    const r = await criarMembroAction(null, form());
    expect(r.ok).toBe(true);
    expect(r).not.toHaveProperty("senhaProvisoria");
    expect(externo).toEqual(antes);
    expect(fixture.tabelas.usuarios).toContainEqual(expect.objectContaining({ user_id: externo.id }));
    semMutacaoAuth();
    expect((await redefinirSenhaAction(null, form({ user_id: externo.id }))).ok).toBe(false);
    expect(externo).toEqual(antes);
    semMutacaoAuth();
  });

  it("aceita reset só com app_metadata legítimo, mesmo sem origem no user_metadata", async () => {
    const proprio = conta({ app_metadata: { origem: "plataforma-comauto" }, user_metadata: { origem: "outro-valor-nao-confiavel" } });
    membro(proprio);
    const antes = proprio.password;
    const r = await redefinirSenha(admin, proprio.id);
    expect(r.ok).toBe(true);
    if (!r.ok) throw new Error(r.motivo);
    expect(r.senhaProvisoria).toEqual(expect.any(String));
    expect(r.senhaProvisoria).not.toBe(antes);
    expect(proprio.password).toBe(r.senhaProvisoria);
    expect(fixture.updateUserById).toHaveBeenCalledExactlyOnceWith(proprio.id, { password: r.senhaProvisoria });
    expect(JSON.stringify(fixture.auditar.mock.calls)).not.toContain(r.senhaProvisoria!);
  });

  it("não entrega senha se o reset de conta controlada falhar", async () => {
    const proprio = conta({ app_metadata: { origem: "plataforma-comauto" } });
    membro(proprio);
    const antes = structuredClone(proprio);
    fixture.erroAtualizar = true;
    const r = await redefinirSenha(admin, proprio.id);
    expect(r.ok).toBe(false);
    expect(r).not.toHaveProperty("senhaProvisoria");
    expect(proprio).toEqual(antes);
    expect(fixture.auditar).not.toHaveBeenCalled();
  });

  it("recusa reset quando Auth não pode confirmar a conta", async () => {
    const proprio = conta({ app_metadata: { origem: "plataforma-comauto" } });
    membro(proprio);
    fixture.erroObter = true;
    expect((await redefinirSenha(admin, proprio.id)).ok).toBe(false);
    expect(fixture.updateUserById).not.toHaveBeenCalled();
  });

  it("gera senha legível com letras e números", () => {
    for (const tamanho of [12, 20]) {
      const senha = gerarSenhaProvisoria(tamanho);
      expect(senha).toHaveLength(tamanho);
      expect(senha).toMatch(/^[ABCDEFGHJKMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789]+$/);
      expect(senha).toMatch(/[A-Za-z]/);
      expect(senha).toMatch(/[2-9]/);
    }
  });
});

describe("recuperação de cadastro parcial", () => {
  it("retry de createUser concluído + INSERT recusado recupera a mesma conta com NOVA senha", async () => {
    fixture.falhasInsert = 1;
    const primeira = await criarMembroAction(null, form());
    expect(primeira.ok).toBe(false);
    expect(primeira).not.toHaveProperty("senhaProvisoria");
    expect(fixture.tabelas.usuarios).toHaveLength(1);
    expect(fixture.authUsers).toHaveLength(2);
    const orfao = fixture.authUsers.find(u => u.email === dados.email)!;
    const senhaAnterior = orfao.password;
    expect(orfao.app_metadata.origem).toBe("plataforma-comauto");
    expect(fixture.auditar).not.toHaveBeenCalled();

    const retry = await criarMembroAction(null, form());
    expect(retry.ok).toBe(true);
    if (!retry.ok) throw new Error(retry.motivo);
    expect(retry.senhaProvisoria).toEqual(expect.any(String));
    expect(retry.senhaProvisoria).not.toBe(senhaAnterior);
    expect(orfao.password).toBe(retry.senhaProvisoria);
    expect(fixture.createUser).toHaveBeenCalledTimes(1);
    expect(fixture.updateUserById).toHaveBeenCalledExactlyOnceWith(orfao.id, { password: retry.senhaProvisoria });
    expect(fixture.authUsers).toHaveLength(2);
    expect(fixture.tabelas.usuarios).toHaveLength(2);
    expect(fixture.tabelas.usuarios[1].user_id).toBe(orfao.id);
    expect(JSON.stringify(fixture.auditar.mock.calls)).not.toContain(retry.senhaProvisoria!);
  });

  it("falha no reset depois da inclusão preserva o vínculo e orienta usar Nova senha", async () => {
    const orfao = conta({ app_metadata: { origem: "plataforma-comauto" } });
    const antes = structuredClone(orfao);
    fixture.erroAtualizar = true;
    const r = await criarMembroAction(null, form());
    expect(r.ok).toBe(false);
    expect(r).not.toHaveProperty("senhaProvisoria");
    if (r.ok) throw new Error("O reset indisponível deve devolver feedback de falha");
    expect(r.motivo).toMatch(/inclu[ií]d[ao]/i);
    expect(r.motivo).toMatch(/nova senha/i);
    expect(orfao).toEqual(antes);
    expect(fixture.tabelas.usuarios).toHaveLength(2);
    expect(fixture.tabelas.usuarios[1].user_id).toBe(orfao.id);
    expect(fixture.inclusoes).toHaveLength(1);
    expect(fixture.createUser).not.toHaveBeenCalled();
    expect(fixture.deleteUser).not.toHaveBeenCalled();
    expect(fixture.revalidatePath).toHaveBeenCalledWith("/painel/configuracoes");

    fixture.erroAtualizar = false;
    const recuperacao = await redefinirSenhaAction(null, form({ user_id: orfao.id }));
    expect(recuperacao.ok).toBe(true);
    if (!recuperacao.ok) throw new Error(recuperacao.motivo);
    expect(recuperacao.senhaProvisoria).toBe(orfao.password);
  });

  it("INSERT recusado em recuperação não gera nem troca senha e permite novo retry", async () => {
    const orfao = conta({ app_metadata: { origem: "plataforma-comauto" } });
    const senhaAnterior = orfao.password;
    fixture.falhasInsert = 1;
    const falha = await criarMembro(admin, dados);
    expect(falha.ok).toBe(false);
    expect(falha).not.toHaveProperty("senhaProvisoria");
    expect(orfao.password).toBe(senhaAnterior);
    expect(fixture.chamadasRandom).toBe(0);
    expect(fixture.updateUserById).not.toHaveBeenCalled();
    expect(fixture.tabelas.usuarios).toHaveLength(1);
    const r = await criarMembro(admin, dados);
    expect(r.ok).toBe(true);
    if (!r.ok) throw new Error(r.motivo);
    expect(r.senhaProvisoria).not.toBe(senhaAnterior);
    expect(orfao.password).toBe(r.senhaProvisoria);
    expect(fixture.updateUserById).toHaveBeenCalledTimes(1);
    expect(fixture.createUser).not.toHaveBeenCalled();
  });

  it("duas recuperações concorrentes deixam só a vencedora do INSERT redefinir a senha", async () => {
    const orfao = conta({ app_metadata: { origem: "plataforma-comauto" } });
    const respostas = await Promise.all([criarMembro(admin, dados), criarMembro(admin, dados)]);
    const vencedora = respostas.find(r => r.ok);
    const perdedora = respostas.find(r => !r.ok);
    expect(vencedora?.ok).toBe(true);
    expect(perdedora?.ok).toBe(false);
    if (!vencedora?.ok) throw new Error("Uma recuperação deveria conseguir incluir o membro");
    expect(perdedora).not.toHaveProperty("senhaProvisoria");
    expect(fixture.inclusoes).toHaveLength(2);
    expect(fixture.tabelas.usuarios).toHaveLength(2);
    expect(fixture.authUsers).toHaveLength(2);
    expect(fixture.updateUserById).toHaveBeenCalledExactlyOnceWith(orfao.id, { password: vencedora.senhaProvisoria });
    expect(orfao.password).toBe(vencedora.senhaProvisoria);
    expect(fixture.createUser).not.toHaveBeenCalled();
    expect(fixture.deleteUser).not.toHaveBeenCalled();
  });

  it("não redefine a senha de conta controlada que já está na equipe", async () => {
    const proprio = conta({ app_metadata: { origem: "plataforma-comauto" } });
    membro(proprio);
    const r = await criarMembro(admin, dados);
    expect(r.ok).toBe(false);
    expect(r).not.toHaveProperty("senhaProvisoria");
    semMutacaoAuth();
  });
});

describe("busca completa no Auth compartilhado", () => {
  function preencher(quantidade: number) {
    for (let n = 0; n < quantidade; n++) conta({ id: uuid(10000 + n), email: `externo-${n}@example.test` });
  }

  it("encontra e vincula login além dos primeiros 4.000 sem tentar recriá-lo", async () => {
    preencher(4000);
    const externo = conta({ email: "DEPOIS-4000@example.test", id: uuid(99999) });
    const r = await criarMembro(admin, { ...dados, email: " depois-4000@example.test " });
    expect(r.ok).toBe(true);
    expect(r).not.toHaveProperty("senhaProvisoria");
    expect(fixture.listUsers.mock.calls.map(([p]) => p.page)).toEqual(Array.from({ length: 21 }, (_, i) => i + 1));
    expect(fixture.listUsers.mock.calls.every(([p]) => p.perPage === 200)).toBe(true);
    expect(fixture.tabelas.usuarios).toContainEqual(expect.objectContaining({ user_id: externo.id }));
    semMutacaoAuth();
  });

  it("só conclui ausência depois da página curta, inclusive após página cheia", async () => {
    preencher(199); // inclui o administrador: primeira página tem exatamente 200 contas
    const r = await criarMembro(admin, dados);
    expect(r.ok).toBe(true);
    expect(fixture.listUsers.mock.calls.map(([p]) => p.page)).toEqual([1, 2]);
    expect(fixture.createUser).toHaveBeenCalledTimes(1);
  });

  it.each([1, 21])("erro na página %i recusa cadastro sem criar conta duplicada", async pagina => {
    if (pagina === 21) preencher(4000);
    fixture.erroBuscaPagina = pagina;
    const antes = structuredClone(fixture.authUsers);
    const r = await criarMembroAction(null, form());
    expect(r.ok).toBe(false);
    expect(r).not.toHaveProperty("senhaProvisoria");
    expect(fixture.authUsers).toEqual(antes);
    expect(fixture.tabelas.usuarios).toHaveLength(1);
    expect(fixture.inclusoes).toHaveLength(0);
    semMutacaoAuth();
  });
});

describe("ações e acesso local da equipe", () => {
  it("salvarEquipe não deixa o administrador desativar a própria conta por formulário", async () => {
    await salvarEquipe(form({ user_id: admin.id, papel: "admin", setor: "administracao", ativo: null }));
    expect(fixture.exigirAcesso).toHaveBeenCalledWith("configuracoes");
    expect(fixture.tabelas.usuarios[0].ativo).toBe(true);
    expect(fixture.atualizacoes).toHaveLength(0);
    expect(fixture.auditar).not.toHaveBeenCalled();
    semMutacaoAuth();
  });

  it("permite salvar outros campos do próprio administrador com ativo preservado", async () => {
    await salvarEquipe(form({ user_id: admin.id, papel: "admin", setor: "administracao", ativo: "on", telefone: "(51) 99999-0000", recebe_alertas: "on" }));
    expect(fixture.tabelas.usuarios[0]).toMatchObject({
      ativo: true, telefone_whatsapp: "5551999990000", recebe_alertas: true,
    });
    expect(fixture.auditar).toHaveBeenCalledTimes(1);
    semMutacaoAuth();
  });

  it("definirAtivo e a action também recusam a desativação do próprio administrador", async () => {
    expect((await definirAtivo(admin, admin.id, false)).ok).toBe(false);
    await definirAtivoAction(form({ user_id: admin.id, ativo: "0" }));
    expect(fixture.tabelas.usuarios[0].ativo).toBe(true);
    expect(fixture.atualizacoes).toHaveLength(0);
    semMutacaoAuth();
  });

  it.each(["uppercase", "braces"] as const)("protege o próprio administrador com target UUID %s", async formato => {
    const target = formato === "uppercase" ? admin.id.toUpperCase() : `{${admin.id}}`;
    expect(target).not.toBe(admin.id);
    expect((await definirAtivo(admin, target, false)).ok).toBe(false);
    await definirAtivoAction(form({ user_id: target, ativo: "0" }));
    await salvarEquipe(form({ user_id: target, papel: "admin", setor: "administracao", ativo: null }));
    expect(fixture.tabelas.usuarios[0].ativo).toBe(true);
    expect(fixture.atualizacoes).toHaveLength(0);
    expect(fixture.auditar).not.toHaveBeenCalled();
    semMutacaoAuth();
  });

  it("compara o UUID do administrador autenticado sem distinguir maiúsculas", async () => {
    const actor = { ...admin, id: admin.id.toUpperCase() };
    expect((await definirAtivo(actor, admin.id, false)).ok).toBe(false);
    fixture.exigirAcesso.mockResolvedValue(actor);
    await definirAtivoAction(form({ user_id: admin.id, ativo: "0" }));
    await salvarEquipe(form({ user_id: admin.id, papel: "admin", setor: "administracao", ativo: null }));
    expect(fixture.tabelas.usuarios[0].ativo).toBe(true);
    expect(fixture.atualizacoes).toHaveLength(0);
    expect(fixture.auditar).not.toHaveBeenCalled();
    semMutacaoAuth();
  });

  it("desativação e reativação mudam só a tabela local, preservando Auth externo", async () => {
    const externo = conta();
    membro(externo);
    const antes = structuredClone(fixture.authUsers);
    expect((await definirAtivo(admin, externo.id, false)).ok).toBe(true);
    expect(fixture.tabelas.usuarios.find(u => u.user_id === externo.id)?.ativo).toBe(false);
    expect((await definirAtivo(admin, externo.id, true)).ok).toBe(true);
    expect(fixture.tabelas.usuarios.find(u => u.user_id === externo.id)?.ativo).toBe(true);
    expect(fixture.authUsers).toEqual(antes);
    expect(fixture.listUsers).not.toHaveBeenCalled();
    expect(fixture.getUserById).not.toHaveBeenCalled();
    semMutacaoAuth();
  });

  it("salvarEquipe pode desativar outro membro sem alterar o login compartilhado", async () => {
    const externo = conta();
    membro(externo);
    const antes = structuredClone(fixture.authUsers);
    await salvarEquipe(form({ user_id: externo.id, ativo: null }));
    expect(fixture.tabelas.usuarios.find(u => u.user_id === externo.id)?.ativo).toBe(false);
    expect(fixture.authUsers).toEqual(antes);
    semMutacaoAuth();
  });

  it.each([
    { nome: " " }, { email: "invalido" }, { papel: "superadmin" },
    { papel: "atendente" }, { setor: "inexistente" }, { unidade: "inexistente" },
  ])("cadastro inválido é recusado antes de tocar Auth: %j", async invalido => {
    expect((await criarMembroAction(null, form(invalido))).ok).toBe(false);
    expect(fixture.listUsers).not.toHaveBeenCalled();
    expect(fixture.inclusoes).toHaveLength(0);
    semMutacaoAuth();
  });

  it("as ações exigem acesso administrativo antes de qualquer operação", async () => {
    fixture.exigirAcesso.mockRejectedValue(new Error("fixture_sem_permissao"));
    await expect(criarMembroAction(null, form())).rejects.toThrow("fixture_sem_permissao");
    await expect(redefinirSenhaAction(null, form({ user_id: uuid(10) }))).rejects.toThrow("fixture_sem_permissao");
    await expect(definirAtivoAction(form({ user_id: uuid(10), ativo: "0" }))).rejects.toThrow("fixture_sem_permissao");
    await expect(salvarEquipe(form({ user_id: uuid(10) }))).rejects.toThrow("fixture_sem_permissao");
    expect(fixture.from).not.toHaveBeenCalled();
    expect(fixture.listUsers).not.toHaveBeenCalled();
    semMutacaoAuth();
  });
});
