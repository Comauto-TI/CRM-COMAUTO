import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Usuario } from "@/lib/auth";
import { administradorPrincipalId, obterPermissoesSenhas, podeAlterarPerfilUsuario } from "@/lib/permissoes-senhas";
import { redefinirSenha, criarMembro, definirAtivo } from "@/lib/equipe";
import { trocarMinhaSenha, verificarTrocaMinhaSenha } from "@/lib/conta";
import { definirPermissaoSenhasAction, salvarEquipe } from "@/app/painel/configuracoes/actions";

const f = vi.hoisted(() => ({ from: vi.fn(), rpc: vi.fn(), getAuth: vi.fn(), updateAuth: vi.fn(), listAuth: vi.fn(), createAuth: vi.fn(), login: vi.fn(), logout: vi.fn(), audit: vi.fn(), auth: vi.fn(), cache: vi.fn(), rows: [] as Record<string, unknown>[], dbError: false, writes: [] as { tabela: string; dados: Record<string, unknown> }[] }));
vi.mock("@/lib/supabase/admin", () => ({ db: () => ({ from: f.from, rpc: f.rpc, auth: { admin: { getUserById: f.getAuth, updateUserById: f.updateAuth, listUsers: f.listAuth, createUser: f.createAuth } } }) }));
vi.mock("@supabase/supabase-js", () => ({ createClient: () => ({ auth: { signInWithPassword: f.login, signOut: f.logout } }) }));
vi.mock("@/lib/auth", () => ({ exigirAcesso: f.auth }));
vi.mock("@/lib/audit", () => ({ auditar: f.audit }));
vi.mock("@/lib/config", () => ({ invalidarConfig: vi.fn(), getConfig: vi.fn() }));
vi.mock("@/lib/usuarios", () => ({ tabelaUsuarios: async () => "usuarios" }));
vi.mock("next/cache", () => ({ revalidatePath: f.cache }));
const PRINCIPAL = "a7100000-0000-4000-8000-000000000001", ADMIN = "a7100000-0000-4000-8000-000000000002", ALVO = "a7100000-0000-4000-8000-000000000003";
const usuario = (id = PRINCIPAL): Usuario => ({ id, nome: "Nome fictício sem autoridade", email: "ficticio@fixture.invalid", papel: "admin", setor: "administracao", unidade: "comauto", unidades: ["comauto"] });
const linha = (user_id: string, extra: Record<string, unknown> = {}) => ({ user_id, nome: "Pessoa fictícia", papel: "admin", ativo: true, pode_redefinir_senhas: false, ...extra });
function consulta(tabela: string) {
  const filtros: ((row: Record<string, unknown>) => boolean)[] = []; let patch: Record<string, unknown> | null = null, insert: Record<string, unknown> | null = null;
  const executar = () => {
    if (f.dbError) return { data: null, error: { code: "XX000" } };
    const dados = tabela === "unidades" ? [{ chave: "comauto" }] : f.rows.filter(row => filtros.every(filtro => filtro(row)));
    if (patch) { for (const row of dados) Object.assign(row, patch); f.writes.push({ tabela, dados: patch }); }
    if (insert) { f.rows.push(insert); f.writes.push({ tabela, dados: insert }); }
    return { data: structuredClone(dados), error: null };
  };
  const q = { select: () => q, eq: (coluna: string, valor: unknown) => { filtros.push(row => row[coluna] === valor); return q; }, in: (coluna: string, valores: unknown[]) => { filtros.push(row => valores.includes(row[coluna])); return q; }, limit: () => q, order: () => q,
    update: (dados: Record<string, unknown>) => { patch = dados; return q; }, insert: (dados: Record<string, unknown>) => { insert = dados; return q; },
    maybeSingle: async () => { const r = executar(); return { ...r, data: r.data?.[0] ?? null }; }, single: async () => { const r = executar(); return { ...r, data: r.data?.[0] ?? null }; },
    then: (resolve: (v: unknown) => unknown, reject: (e: unknown) => unknown) => Promise.resolve(executar()).then(resolve, reject),
  }; return q;
}
const form = (dados: Record<string, string>) => { const f = new FormData(); for (const [k, v] of Object.entries(dados)) f.set(k, v); return f; };
beforeEach(() => {
  vi.resetAllMocks(); vi.stubEnv("ADMIN_PRINCIPAL_ID", PRINCIPAL); f.dbError = false; f.writes = [];
  f.rows = [linha(PRINCIPAL), linha(ADMIN), linha(ALVO, { papel: "pecas" })]; f.from.mockImplementation(consulta); f.auth.mockResolvedValue(usuario());
  f.getAuth.mockImplementation(async id => ({ data: { user: { id, app_metadata: { origem: "plataforma-comauto" }, user_metadata: {} } }, error: null }));
  f.updateAuth.mockResolvedValue({ data: {}, error: null }); f.login.mockResolvedValue({ data: { user: { id: PRINCIPAL } }, error: null }); f.logout.mockResolvedValue({ error: null });
  f.rpc.mockResolvedValue({ data: { ok: true, alterado: true }, error: null });
});
afterEach(() => vi.unstubAllEnvs());

describe("administrador principal e delegação no servidor", () => {
  it.each(["", "nome-da-pessoa", "email@fixture.invalid", ` ${PRINCIPAL}`, `{${PRINCIPAL}}`, "senha-ficticia"])("configuração inválida %s não ganha fallback", async valor => {
    vi.stubEnv("ADMIN_PRINCIPAL_ID", valor);
    expect(administradorPrincipalId()).toBeNull(); expect((await obterPermissoesSenhas(usuario())).podeRedefinir).toBe(false); expect(f.from).not.toHaveBeenCalled();
  });
  it("UUID principal válido é canônico e não depende do nome ou e-mail", async () => {
    vi.stubEnv("ADMIN_PRINCIPAL_ID", PRINCIPAL.toUpperCase());
    expect(administradorPrincipalId()).toBe(PRINCIPAL);
    expect(await obterPermissoesSenhas({ ...usuario(), nome: "Outro nome", email: "outro@fixture.invalid" })).toMatchObject({ principal: true, podeRedefinir: true });
    expect(await obterPermissoesSenhas({ ...usuario(ADMIN), nome: usuario().nome, email: usuario().email })).toMatchObject({ principal: false, podeRedefinir: false });
  });
  it("admin novo não recebe reset; concessão e revogação são relidas em cada chamada", async () => {
    expect((await obterPermissoesSenhas(usuario(ADMIN))).podeRedefinir).toBe(false);
    f.rows[1].pode_redefinir_senhas = true; expect((await obterPermissoesSenhas(usuario(ADMIN))).podeRedefinir).toBe(true);
    f.rows[1].pode_redefinir_senhas = false; expect((await obterPermissoesSenhas(usuario(ADMIN))).podeRedefinir).toBe(false);
  });
  it.each(["ator-inativo", "ator-rebaixado", "principal-inativo", "principal-rebaixado", "consulta-falhou"])("recusa %s", async modo => {
    f.rows[1].pode_redefinir_senhas = true;
    if (modo === "ator-inativo") f.rows[1].ativo = false;
    if (modo === "ator-rebaixado") f.rows[1].papel = "gerente";
    if (modo === "principal-inativo") f.rows[0].ativo = false;
    if (modo === "principal-rebaixado") f.rows[0].papel = "gerente";
    if (modo === "consulta-falhou") f.dbError = true;
    expect((await obterPermissoesSenhas(usuario(ADMIN))).podeRedefinir).toBe(false);
  });
  it("só principal concede flag; RPC recebe exclusivamente identidade da sessão e UUID do ambiente", async () => {
    const d = form({ user_id: ADMIN, permitir: "1", p_ator: ALVO, p_principal: ALVO, p_ator_email: "forjado@fixture.invalid" });
    expect(await definirPermissaoSenhasAction(d)).toMatchObject({ ok: true });
    expect(f.rpc).toHaveBeenCalledExactlyOnceWith("definir_permissao_senhas", { p_ator: PRINCIPAL, p_principal: PRINCIPAL, p_destino: ADMIN, p_permitir: true, p_ator_email: usuario().email });
    f.auth.mockResolvedValue(usuario(ADMIN)); f.rows[1].pode_redefinir_senhas = true; f.rpc.mockClear();
    expect(await definirPermissaoSenhasAction(d)).toMatchObject({ ok: false }); expect(f.rpc).not.toHaveBeenCalled();
  });
  it("principal protegido contra outro admin e contra autodesativação/rebaixamento", async () => {
    f.rows[1].pode_redefinir_senhas = true;
    expect(await podeAlterarPerfilUsuario(usuario(ADMIN), PRINCIPAL.toUpperCase(), true, "admin")).toBe(false);
    expect(await podeAlterarPerfilUsuario(usuario(), PRINCIPAL, false, "admin")).toBe(false);
    expect(await podeAlterarPerfilUsuario(usuario(), PRINCIPAL, true, "gerente")).toBe(false);
    expect(await podeAlterarPerfilUsuario(usuario(), PRINCIPAL, true, "admin")).toBe(true);
    expect((await definirAtivo(usuario(ADMIN), PRINCIPAL, false)).ok).toBe(false); expect(f.writes).toHaveLength(0);
  });
  it("perfil demovido/desativado perde flag no mesmo UPDATE", async () => {
    f.rows[1].pode_redefinir_senhas = true;
    await salvarEquipe(form({ user_id: ADMIN, papel: "gerente", setor: "administracao", ativo: "on" }));
    expect(f.rows[1]).toMatchObject({ papel: "gerente", ativo: true, pode_redefinir_senhas: false });
    f.rows[1].papel = "admin"; f.rows[1].pode_redefinir_senhas = true;
    expect((await definirAtivo(usuario(), ADMIN, false)).ok).toBe(true); expect(f.rows[1]).toMatchObject({ ativo: false, pode_redefinir_senhas: false });
  });
});

describe("reset administrativo com origem preservada", () => {
  it("admin sem delegação não consulta Auth nem troca senha", async () => {
    expect((await redefinirSenha(usuario(ADMIN), ALVO)).ok).toBe(false); expect(f.getAuth).not.toHaveBeenCalled(); expect(f.updateAuth).not.toHaveBeenCalled();
  });
  it("principal ou delegado pode resetar conta da plataforma uma vez", async () => {
    f.rows[1].pode_redefinir_senhas = true;
    for (const ator of [usuario(), usuario(ADMIN)]) {
      f.updateAuth.mockClear(); const r = await redefinirSenha(ator, ALVO); expect(r.ok).toBe(true);
      expect(f.updateAuth).toHaveBeenCalledTimes(1); expect(JSON.stringify(f.audit.mock.calls)).not.toContain(r.ok ? r.senhaProvisoria! : "impossível");
    }
  });
  it("delegado não reseta principal, mesmo com origem plataforma", async () => {
    f.rows[1].pode_redefinir_senhas = true;
    expect((await redefinirSenha(usuario(ADMIN), PRINCIPAL)).ok).toBe(false); expect(f.updateAuth).not.toHaveBeenCalled();
  });
  it("alvo desativado não permite reset nem consulta Auth", async () => {
    f.rows[2].ativo = false;
    expect((await redefinirSenha(usuario(), ALVO)).ok).toBe(false);
    expect(f.getAuth).not.toHaveBeenCalled(); expect(f.updateAuth).not.toHaveBeenCalled();
  });
  it("Auth que retorna outro UUID não autoriza reset", async () => {
    f.getAuth.mockResolvedValue({ data: { user: { id: ADMIN, app_metadata: { origem: "plataforma-comauto" } } }, error: null });
    expect((await redefinirSenha(usuario(), ALVO)).ok).toBe(false); expect(f.updateAuth).not.toHaveBeenCalled();
  });
  it("exceção compartilhada vale só para o reset do próprio principal", async () => {
    f.getAuth.mockImplementation(async id => ({ data: { user: { id, app_metadata: {}, user_metadata: { origem: "plataforma-comauto" } } }, error: null }));
    expect((await redefinirSenha(usuario(), ALVO)).ok).toBe(false); expect(f.updateAuth).not.toHaveBeenCalled();
    expect((await redefinirSenha(usuario(), PRINCIPAL)).ok).toBe(true); expect(f.updateAuth).toHaveBeenCalledTimes(1); expect(f.updateAuth.mock.calls[0][0]).toBe(PRINCIPAL);
  });
  it("revogação durante consulta Auth bloqueia a escrita seguinte", async () => {
    f.rows[1].pode_redefinir_senhas = true;
    f.getAuth.mockImplementation(async id => { f.rows[1].pode_redefinir_senhas = false; return { data: { user: { id, app_metadata: { origem: "plataforma-comauto" } } }, error: null }; });
    expect((await redefinirSenha(usuario(ADMIN), ALVO)).ok).toBe(false); expect(f.updateAuth).not.toHaveBeenCalled();
  });
  it.each(["alvo-inativo", "alvo-ausente", "principal-inativo", "principal-alterado", "consulta-falhou"])("revalida %s após a espera do Auth, antes de enviar o reset", async modo => {
    f.rows[1].pode_redefinir_senhas = true;
    let liberar!: () => void;
    const espera = new Promise<void>(resolve => { liberar = resolve; });
    f.getAuth.mockImplementation(async id => {
      await espera;
      return { data: { user: { id, app_metadata: { origem: "plataforma-comauto" } } }, error: null };
    });
    const resultado = redefinirSenha(usuario(ADMIN), ALVO);
    await vi.waitFor(() => expect(f.getAuth).toHaveBeenCalledOnce());
    if (modo === "alvo-inativo") f.rows[2].ativo = false;
    if (modo === "alvo-ausente") f.rows = f.rows.filter(row => row.user_id !== ALVO);
    if (modo === "principal-inativo") f.rows[0].ativo = false;
    if (modo === "principal-alterado") vi.stubEnv("ADMIN_PRINCIPAL_ID", ADMIN);
    if (modo === "consulta-falhou") f.dbError = true;
    liberar();
    expect((await resultado).ok).toBe(false); expect(f.updateAuth).not.toHaveBeenCalled();
  });
  it("recuperação de Auth órfão não contorna a nova autoridade", async () => {
    f.listAuth.mockResolvedValue({ data: { users: [{ id: "a7100000-0000-4000-8000-000000000004", email: "orfao@fixture.invalid", app_metadata: { origem: "plataforma-comauto" } }] }, error: null });
    expect((await criarMembro(usuario(ADMIN), { nome: "Órfão fictício", email: "orfao@fixture.invalid", papel: "pecas", setor: "pecas", unidade: "comauto" })).ok).toBe(false);
    expect(f.writes).toHaveLength(0); expect(f.updateAuth).not.toHaveBeenCalled();
  });
  it.each(["alvo-inativo", "alvo-ausente", "ator-revogado", "principal-alterado"])("recuperação relê %s depois da inclusão e auditoria", async modo => {
    f.rows[1].pode_redefinir_senhas = true; f.rows = f.rows.filter(row => row.user_id !== ALVO);
    f.listAuth.mockResolvedValue({ data: { users: [{ id: ALVO, email: "orfao@fixture.invalid", app_metadata: { origem: "plataforma-comauto" } }] }, error: null });
    f.audit.mockImplementation(async (_email, acao) => {
      if (acao !== "equipe_criar") return;
      if (modo === "alvo-inativo") f.rows.find(row => row.user_id === ALVO)!.ativo = false;
      if (modo === "alvo-ausente") f.rows = f.rows.filter(row => row.user_id !== ALVO);
      if (modo === "ator-revogado") f.rows.find(row => row.user_id === ADMIN)!.pode_redefinir_senhas = false;
      if (modo === "principal-alterado") vi.stubEnv("ADMIN_PRINCIPAL_ID", ADMIN);
    });
    const resultado = await criarMembro(usuario(ADMIN), { nome: "Órfão fictício", email: "orfao@fixture.invalid", papel: "pecas", setor: "pecas", unidade: "comauto" });
    expect(f.writes).toHaveLength(1); expect(resultado.ok).toBe(false); expect(f.updateAuth).not.toHaveBeenCalled();
  });
});

describe("troca da própria senha", () => {
  it("erro de consulta Auth não é apresentado como conta externa", async () => {
    f.getAuth.mockResolvedValue({ data: { user: null }, error: { code: "service_unavailable" } });
    expect(await verificarTrocaMinhaSenha(usuario())).toMatchObject({ ok: false, motivo: expect.stringContaining("verificar seu login") });
  });
  it("usuário comum da plataforma continua podendo trocar; externo só principal", async () => {
    expect(await verificarTrocaMinhaSenha({ ...usuario(ALVO), papel: "pecas" })).toEqual({ ok: true, compartilhada: false });
    f.getAuth.mockImplementation(async id => ({ data: { user: { id, app_metadata: {} } }, error: null }));
    expect(await verificarTrocaMinhaSenha(usuario(ADMIN))).toMatchObject({ ok: false });
    expect(await verificarTrocaMinhaSenha(usuario())).toEqual({ ok: true, compartilhada: true });
  });
  it("confirma identidade do login e encerra somente a sessão temporária local", async () => {
    expect((await trocarMinhaSenha(usuario(), "atual-ficticia", "nova-ficticia", "nova-ficticia")).ok).toBe(true);
    expect(f.logout).toHaveBeenCalledExactlyOnceWith({ scope: "local" }); expect(f.updateAuth).toHaveBeenCalledExactlyOnceWith(PRINCIPAL, { password: "nova-ficticia" });
  });
  it("senha que autentica outro UUID não autoriza mudança", async () => {
    f.login.mockResolvedValue({ data: { user: { id: ALVO } }, error: null });
    expect((await trocarMinhaSenha(usuario(), "atual-ficticia", "nova-ficticia", "nova-ficticia")).ok).toBe(false);
    expect(f.logout).toHaveBeenCalledWith({ scope: "local" }); expect(f.updateAuth).not.toHaveBeenCalled();
  });
  it.each([["invalid_credentials", "Senha atual incorreta"], ["fetch_error", "Não foi possível confirmar"]])("erro %s tem mensagem correta sem escrever", async (code, mensagem) => {
    f.login.mockResolvedValue({ data: { user: null }, error: { code } });
    expect(await trocarMinhaSenha(usuario(), "atual-ficticia", "nova-ficticia", "nova-ficticia")).toMatchObject({ ok: false, motivo: expect.stringContaining(mensagem) });
    expect(f.updateAuth).not.toHaveBeenCalled();
  });
});
