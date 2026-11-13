import { createHash } from "node:crypto";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Usuario } from "@/lib/auth";
import { cadastrarPeloConvite, criarConvite, lerConvite, TIPOS_CONVITE } from "@/lib/convites";
import { criarConviteAction } from "@/app/painel/usuarios/actions";
import { cadastrarAction } from "@/app/cadastro/[token]/actions";
import NovoLink from "@/app/painel/usuarios/NovoLink";

const f = vi.hoisted(() => ({ from: vi.fn(), rpc: vi.fn(), audit: vi.fn(), notificar: vi.fn(), acharAuth: vi.fn(), criar: vi.fn(), excluir: vi.fn(), auth: vi.fn(), revalidate: vi.fn() }));
vi.mock("@/lib/supabase/admin", () => ({ db: () => ({ from: f.from, rpc: f.rpc, auth: { admin: { createUser: f.criar, deleteUser: f.excluir } } }) }));
vi.mock("@/lib/audit", () => ({ auditar: f.audit }));
vi.mock("@/lib/notificacoes", () => ({ notificar: f.notificar }));
vi.mock("@/lib/equipe", () => ({ acharNoAuthPorEmail: f.acharAuth }));
vi.mock("@/lib/conta", () => ({ SENHA_MINIMA: 6 }));
vi.mock("@/lib/auth", () => ({ exigirAcesso: f.auth }));
vi.mock("next/cache", () => ({ revalidatePath: f.revalidate }));
vi.mock("next/headers", () => ({ headers: async () => ({ get: (key: string) => key === "host" ? "fixture.invalid" : "https" }) }));
vi.mock("next/navigation", () => ({ redirect: (url: string) => { throw new Error(`REDIRECT:${url}`); } }));
const ID = "cf000000-0000-4000-8000-000000000001", CONVITE = "cf000000-0000-4000-8000-000000000002", NOVO = "cf000000-0000-4000-8000-000000000003";
const TOKEN = "A".repeat(43), HASH = createHash("sha256").update(TOKEN).digest("hex");
const admin: Usuario = { id: ID, nome: "Admin fictício", email: "admin@fixture.invalid", papel: "admin", setor: "administracao", unidade: "comauto", unidades: ["comauto"] };
const cadastro = { nome: "Pessoa fictícia", email: "pessoa@fixture.invalid", senha: "ficticia123", confirmar: "ficticia123" };
type Resultado = { data: unknown; error: { code: string } | null };
const filas = new Map<string, Resultado[]>();
const operacoes: { tabela: string; metodo: string; args: unknown[] }[] = [];
const ok = (data: unknown): Resultado => ({ data, error: null });
const agora = () => new Date().toISOString();
const linha = (extra: Record<string, unknown> = {}) => {
  const inicio = Date.now();
  return { tipo: "administrador", unidade: "comauto", papel: "admin", setor: "administracao", criado_por: ID,
    criado_em: new Date(inicio).toISOString(), expira_em: new Date(inicio + 86_400_000).toISOString(), usos: 0, max_usos: 1, revogado_em: null, ...extra };
};
const reserva = (extra: Record<string, unknown> = {}) => ({ ok: true, id: CONVITE, tipo: "administrador", papel: "admin", setor: "administracao", unidade: "comauto", criado_por: ID, ...extra });
function builder(tabela: string) {
  const resposta = filas.get(tabela)?.shift() ?? ok(null), q: Record<string, unknown> = {};
  for (const metodo of ["select", "eq", "insert", "order", "limit", "update", "is"]) q[metodo] = (...args: unknown[]) => { operacoes.push({ tabela, metodo, args }); return q; };
  q.maybeSingle = () => Promise.resolve(resposta);
  q.then = (resolve: (v: Resultado) => unknown, reject: (e: unknown) => unknown) => Promise.resolve(resposta).then(resolve, reject);
  return q;
}
const insercoes = (tabela: string) => operacoes.filter(o => o.tabela === tabela && o.metodo === "insert").map(o => o.args[0] as Record<string, unknown>);
beforeEach(() => {
  vi.resetAllMocks(); filas.clear(); operacoes.length = 0; vi.stubEnv("APP_URL", "https://fixture.invalid");
  filas.set("unidades", [ok({ chave: "comauto" })]);
  filas.set("plataforma_convites", [ok(linha())]);
  filas.set("usuarios", [ok({ user_id: ID }), ok(null)]);
  f.from.mockImplementation(builder); f.auth.mockResolvedValue(admin); f.acharAuth.mockResolvedValue(null);
  f.rpc.mockImplementation(async nome => ({ data: nome === "reservar_convite" ? reserva() : null, error: null }));
  f.criar.mockResolvedValue({ data: { user: { id: NOVO } }, error: null }); f.excluir.mockResolvedValue({ error: null });
});
afterEach(() => vi.unstubAllEnvs());

describe("emissão de convite administrativo", () => {
  it.each(["gerente", "vendedor", "pecas", "recepcao", "financeiro", "consultor_tecnico"] as const)("%s não emite convite nem consulta o banco", async papel => {
    expect(await criarConvite({ ...admin, papel }, "administrador", "comauto", 1, 1)).toMatchObject({ ok: false });
    expect(f.from).not.toHaveBeenCalled(); expect(f.audit).not.toHaveBeenCalled();
  });
  it.each(["__proto__", "constructor", "toString", "inexistente"])("recusa tipo forjado %s", async tipo => {
    expect(await criarConvite(admin, tipo, "comauto", 1, 1)).toMatchObject({ ok: false }); expect(f.from).not.toHaveBeenCalled();
  });
  it.each([[30, 50], [Infinity, Infinity], [NaN, NaN], [-10, -10]])("fixa um uso e 24h no servidor para dias=%s/usos=%s", async (dias, usos) => {
    const r = await criarConvite(admin, "administrador", "comauto", dias, usos);
    expect(r.ok).toBe(true);
    const escrito = insercoes("plataforma_convites")[0];
    expect(escrito).toMatchObject({ tipo: "administrador", papel: "admin", setor: "administracao", criado_por: ID, unidade: "comauto", max_usos: 1 });
    expect(Date.parse(escrito.expira_em as string) - Date.parse(escrito.criado_em as string)).toBe(86_400_000);
    if (!r.ok) throw Error("Fixture inválida");
    expect(r.token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(escrito.token_hash).toBe(createHash("sha256").update(r.token).digest("hex"));
    expect(escrito).not.toHaveProperty("token");
    expect(JSON.stringify(f.audit.mock.calls)).not.toContain(r.token);
    expect(f.audit).toHaveBeenCalledWith(admin.email, "criar_convite", "plataforma_convites", null, { tipo: "administrador", unidade: "comauto", dias: 1, usos: 1 });
  });
  it.each(["vendas", "pecas", "agendamento"] as const)("preserva limites e perfil existentes de %s", async tipo => {
    expect(await criarConvite(admin, tipo, "comauto", 30, 50)).toMatchObject({ ok: true });
    expect(insercoes("plataforma_convites")[0]).toMatchObject({ papel: TIPOS_CONVITE[tipo].papel, setor: TIPOS_CONVITE[tipo].setor, max_usos: 50 });
    expect(insercoes("plataforma_convites")[0]).not.toHaveProperty("criado_em");
  });
  it("action exige área administrativa e ignora papel/setor adulterados no formulário", async () => {
    const form = new FormData();
    for (const [k, v] of Object.entries({ tipo: "administrador", unidade: "comauto", dias: "30", usos: "50", papel: "vendedor", setor: "vendas", criado_por: NOVO })) form.set(k, v);
    expect(await criarConviteAction(null, form)).toMatchObject({ ok: true, link: expect.stringMatching(/^https:\/\/fixture.invalid\/cadastro\//) });
    expect(f.auth).toHaveBeenCalledExactlyOnceWith("configuracoes");
    expect(insercoes("plataforma_convites")[0]).toMatchObject({ papel: "admin", setor: "administracao", criado_por: ID, max_usos: 1 });
  });
  it("action com sessão de gerente não passa pela defesa da biblioteca", async () => {
    f.auth.mockResolvedValue({ ...admin, papel: "gerente" });
    const form = new FormData(); form.set("tipo", "administrador");
    expect(await criarConviteAction(null, form)).toMatchObject({ ok: false }); expect(f.from).not.toHaveBeenCalled();
  });
  it("UI oferece administrador e preserva os outros tipos", () => {
    const html = renderToStaticMarkup(createElement(NovoLink, { unidades: [{ chave: "comauto", nome: "Comauto fictícia" }] }));
    for (const tipo of ["vendas", "pecas", "agendamento", "administrador"]) expect(html).toContain(`value="${tipo}"`);
    expect(html).toContain("Administrador (acesso global)");
    expect(f.from).not.toHaveBeenCalled();
  });
});

describe("leitura e resgate do convite administrativo", () => {
  it("leitura mantém DTO público mínimo e confere emissor ativo administrador", async () => {
    expect(await lerConvite(TOKEN)).toEqual({ tipo: "administrador", unidade: "comauto" });
    expect(operacoes).toContainEqual({ tabela: "usuarios", metodo: "eq", args: ["ativo", true] });
    expect(operacoes).toContainEqual({ tabela: "usuarios", metodo: "eq", args: ["papel", "admin"] });
    expect(operacoes).toContainEqual({ tabela: "plataforma_convites", metodo: "eq", args: ["token_hash", HASH] });
  });
  it.each(["token-curto", "", "A".repeat(44)])("token inválido não consulta Auth nem reserva", async token => {
    expect(await cadastrarPeloConvite(token, cadastro)).toMatchObject({ ok: false });
    expect(f.from).not.toHaveBeenCalled(); expect(f.acharAuth).not.toHaveBeenCalled(); expect(f.rpc).not.toHaveBeenCalled(); expect(f.criar).not.toHaveBeenCalled();
  });
  it.each([
    { revogado_em: agora() }, { usos: 1 }, { expira_em: "2000-01-01T00:00:00Z" }, { papel: "vendedor" }, { setor: "vendas" },
    { max_usos: 50 }, { criado_por: null }, { criado_em: "inválido" }, { expira_em: "inválido" }, { expira_em: new Date(Date.now() + 2 * 86_400_000).toISOString() },
  ])("recusa convite admin inconsistente antes de consultar e-mail %j", async extra => {
    filas.set("plataforma_convites", [ok(linha(extra))]);
    expect(await cadastrarPeloConvite(TOKEN, cadastro)).toMatchObject({ ok: false });
    expect(f.acharAuth).not.toHaveBeenCalled(); expect(f.rpc).not.toHaveBeenCalled(); expect(f.criar).not.toHaveBeenCalled();
  });
  it.each([ok(null), { data: null, error: { code: "XX000" } }])("emissor inexistente/inativo/rebaixado ou consulta falha invalida antes de Auth", async resposta => {
    filas.set("usuarios", [resposta]);
    expect(await cadastrarPeloConvite(TOKEN, cadastro)).toMatchObject({ ok: false });
    expect(f.acharAuth).not.toHaveBeenCalled(); expect(f.criar).not.toHaveBeenCalled(); expect(f.rpc).not.toHaveBeenCalled();
  });
  it("e-mail de conta externa continua recusado sem reservar, alterar senha ou excluir", async () => {
    f.acharAuth.mockResolvedValue({ id: NOVO, origem: "outro-sistema" });
    expect(await cadastrarPeloConvite(TOKEN, cadastro)).toMatchObject({ ok: false });
    expect(f.rpc).not.toHaveBeenCalled(); expect(f.criar).not.toHaveBeenCalled(); expect(f.excluir).not.toHaveBeenCalled();
  });
  it("reserva negada pelo SQL após mudança do emissor não cria Auth", async () => {
    f.rpc.mockResolvedValue({ data: { ok: false }, error: null });
    expect(await cadastrarPeloConvite(TOKEN, cadastro)).toMatchObject({ ok: false }); expect(f.criar).not.toHaveBeenCalled();
  });
  it.each([{ papel: "gerente" }, { setor: "vendas" }, { unidade: "outra" }, { tipo: "vendas" }, { criado_por: null }])("reserva administrativa incoerente devolve uso antes de criar conta %j", async extra => {
    f.rpc.mockImplementation(async nome => ({ data: nome === "reservar_convite" ? reserva(extra) : null, error: null }));
    expect(await cadastrarPeloConvite(TOKEN, cadastro)).toMatchObject({ ok: false });
    expect(f.rpc).toHaveBeenCalledWith("devolver_convite", { p_id: CONVITE }); expect(f.criar).not.toHaveBeenCalled(); expect(f.excluir).not.toHaveBeenCalled();
  });
  it("admin válido usa origem e privilégio somente do servidor", async () => {
    const form = new FormData(); for (const [k, v] of Object.entries({ ...cadastro, token: TOKEN, papel: "vendedor", setor: "vendas", origem: "forjada" })) form.set(k, v);
    await expect(cadastrarAction(form)).rejects.toThrow(`REDIRECT:/cadastro/${TOKEN}?ok=1`);
    expect(f.criar).toHaveBeenCalledExactlyOnceWith({ email: cadastro.email, password: cadastro.senha, email_confirm: true, user_metadata: { nome: cadastro.nome }, app_metadata: { origem: "plataforma-comauto" } });
    expect(insercoes("usuarios")[0]).toEqual({ user_id: NOVO, nome: cadastro.nome, papel: "admin", setor: "administracao", unidade: "comauto", ativo: true });
    expect(f.excluir).not.toHaveBeenCalled();
  });
  it("papel admin forjado no cadastro não promove convite comum", async () => {
    filas.set("plataforma_convites", [ok(linha({ tipo: "vendas", papel: "vendedor", setor: "vendas" }))]); filas.set("usuarios", [ok(null)]);
    f.rpc.mockResolvedValue({ data: reserva({ tipo: "vendas", papel: "vendedor", setor: "vendas" }), error: null });
    expect(await cadastrarPeloConvite(TOKEN, { ...cadastro, papel: "admin", setor: "administracao" } as typeof cadastro)).toEqual({ ok: true });
    expect(insercoes("usuarios")[0]).toMatchObject({ papel: "vendedor", setor: "vendas" });
  });
  it("falha Auth devolve reserva e nunca exclui conta preexistente", async () => {
    f.criar.mockResolvedValue({ data: { user: null }, error: { message: "creation failed" } });
    expect(await cadastrarPeloConvite(TOKEN, cadastro)).toMatchObject({ ok: false });
    expect(f.rpc).toHaveBeenCalledWith("devolver_convite", { p_id: CONVITE }); expect(f.excluir).not.toHaveBeenCalled();
  });
  it("falha de perfil remove somente a conta recém-criada e compensa reserva", async () => {
    filas.set("usuarios", [ok({ user_id: ID }), { data: null, error: { code: "XX000" } }]);
    expect(await cadastrarPeloConvite(TOKEN, cadastro)).toMatchObject({ ok: false });
    expect(f.excluir).toHaveBeenCalledExactlyOnceWith(NOVO); expect(f.rpc).toHaveBeenCalledWith("devolver_convite", { p_id: CONVITE });
  });
});
