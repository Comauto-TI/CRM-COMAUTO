import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Usuario } from "@/lib/auth";
import Usuarios from "@/app/painel/usuarios/page";
import MinhaConta from "@/app/painel/conta/page";

const f = vi.hoisted(() => ({ auth: vi.fn(), from: vi.fn(), capacidades: vi.fn(), propria: vi.fn(), salvar: vi.fn(), reset: vi.fn(), permitir: vi.fn(), membro: vi.fn(), convite: vi.fn(), revogar: vi.fn(), trocar: vi.fn() }));
vi.mock("@/lib/auth", () => ({ exigirAcesso: f.auth }));
vi.mock("@/lib/supabase/admin", () => ({ db: () => ({ from: f.from }) }));
vi.mock("@/lib/config", () => ({ getConfig: async () => ({ fuso_offset: "-03:00" }) }));
vi.mock("@/lib/usuarios", () => ({ tabelaUsuarios: async () => "usuarios" }));
vi.mock("@/lib/convites", () => ({ listarConvites: async () => [], TIPOS_CONVITE: {} }));
vi.mock("@/lib/permissoes-senhas", () => ({ obterPermissoesSenhas: f.capacidades }));
vi.mock("@/lib/conta", () => ({ verificarTrocaMinhaSenha: f.propria, SENHA_MINIMA: 6 }));
vi.mock("@/app/painel/configuracoes/actions", () => ({ salvarEquipe: f.salvar, redefinirSenhaAction: f.reset, definirPermissaoSenhasAction: f.permitir, criarMembroAction: f.membro }));
vi.mock("@/app/painel/usuarios/actions", () => ({ criarConviteAction: f.convite, revogarConviteAction: f.revogar }));
vi.mock("@/app/painel/conta/actions", () => ({ trocarSenhaAction: f.trocar }));
const PRINCIPAL = "cd000000-0000-4000-8000-000000000001", ATOR = "cd000000-0000-4000-8000-000000000002";
const OUTRO = "cd000000-0000-4000-8000-000000000003", EQUIPE = "cd000000-0000-4000-8000-000000000004", INATIVO = "cd000000-0000-4000-8000-000000000005";
const u: Usuario = { id: ATOR, nome: "Admin fictício", email: "admin@fixture.invalid", papel: "admin", setor: "administracao", unidade: "comauto", unidades: ["comauto"] };
const usuarios = [
  { user_id: PRINCIPAL, nome: "Principal fictício", papel: "admin", setor: "administracao", ativo: true, pode_redefinir_senhas: false },
  { user_id: ATOR, nome: "Admin atual", papel: "admin", setor: "administracao", ativo: true, pode_redefinir_senhas: false },
  { user_id: OUTRO, nome: "Outro admin", papel: "admin", setor: "administracao", ativo: true, pode_redefinir_senhas: true },
  { user_id: EQUIPE, nome: "Equipe fictícia", papel: "vendedor", setor: "vendas", ativo: true, pode_redefinir_senhas: false },
  { user_id: INATIVO, nome: "Admin inativo", papel: "admin", setor: "administracao", ativo: false, pode_redefinir_senhas: true },
];
function tabela(t: string) {
  const q = { select: vi.fn(), order: vi.fn(), then: (resolve: (r: { data: unknown[] }) => unknown) => Promise.resolve({ data: t === "usuarios" ? usuarios : [{ chave: "comauto", nome: "Comauto" }] }).then(resolve) };
  q.select.mockReturnValue(q); q.order.mockReturnValue(q); return q;
}
const capacidades = (extra = {}) => ({ principalId: PRINCIPAL, principal: false, podeRedefinir: false, administradorAtivo: true, ...extra });
const tr = (html: string, nome: string) => Array.from(html.matchAll(/<tr\b[^>]*>[\s\S]*?<\/tr>/g), x => x[0]).find(x => x.includes(nome)) ?? "";
const renderUsuarios = async () => renderToStaticMarkup(await Usuarios());
const renderConta = async () => renderToStaticMarkup(await MinhaConta({ searchParams: Promise.resolve({}) }));
beforeEach(() => { vi.resetAllMocks(); f.from.mockImplementation(tabela); f.auth.mockResolvedValue(u); f.capacidades.mockResolvedValue(capacidades()); f.propria.mockResolvedValue({ ok: true, compartilhada: false }); });
afterEach(() => { for (const fn of [f.salvar, f.reset, f.permitir, f.membro, f.convite, f.revogar, f.trocar]) expect(fn).not.toHaveBeenCalled(); });

describe("Usuários: capacidades calculadas no servidor", () => {
  it("admin sem delegação não recebe reset ou controle de delegação; principal permanece sem formulário", async () => {
    const html = await renderUsuarios();
    expect(f.auth).toHaveBeenCalledExactlyOnceWith("configuracoes");
    expect(f.capacidades).toHaveBeenCalledExactlyOnceWith(u);
    expect(html).not.toContain("Nova senha"); expect(html).not.toContain("Salvar permissão");
    expect(tr(html, "Principal fictício")).not.toContain("<form");
    expect(tr(html, "Principal fictício")).toContain("Conta protegida");
    expect(tr(html, "Equipe fictícia")).toContain("<form");
    expect(html).toContain('value="administrador"');
  });
  it("delegação permite reset só de outros ativos, nunca do principal ou do próprio operador", async () => {
    f.capacidades.mockResolvedValue(capacidades({ podeRedefinir: true }));
    const html = await renderUsuarios();
    expect(tr(html, "Outro admin")).toContain("Nova senha");
    expect(tr(html, "Equipe fictícia")).toContain("Nova senha");
    for (const nome of ["Principal fictício", "Admin atual", "Admin inativo"]) expect(tr(html, nome)).not.toContain("Nova senha");
    expect(html).not.toContain("Salvar permissão");
  });
  it("revogação na próxima leitura remove os controles de reset", async () => {
    f.capacidades.mockResolvedValueOnce(capacidades({ podeRedefinir: true })).mockResolvedValueOnce(capacidades());
    expect(await renderUsuarios()).toContain("Nova senha");
    expect(await renderUsuarios()).not.toContain("Nova senha");
  });
  it("principal pode conceder ou revogar só para outros administradores ativos", async () => {
    f.auth.mockResolvedValue({ ...u, id: PRINCIPAL });
    f.capacidades.mockResolvedValue(capacidades({ principal: true, podeRedefinir: true }));
    const html = await renderUsuarios();
    for (const nome of ["Admin atual", "Outro admin"]) expect(tr(html, nome)).toContain("Salvar permissão");
    for (const nome of ["Principal fictício", "Equipe fictícia", "Admin inativo"]) expect(tr(html, nome)).not.toContain("Salvar permissão");
    expect(tr(html, "Outro admin")).toMatch(/type="checkbox"[^>]*name="permitir"[^>]*checked=""/);
    expect(tr(html, "Admin atual")).not.toMatch(/name="permitir"[^>]*checked=""/);
  });
  it("principal não pode desativar ou demover a si mesmo pela UI", async () => {
    f.auth.mockResolvedValue({ ...u, id: PRINCIPAL });
    f.capacidades.mockResolvedValue(capacidades({ principal: true, podeRedefinir: true }));
    const principal = tr(await renderUsuarios(), "Principal fictício");
    expect(principal).toContain('type="hidden" name="papel" value="admin"');
    expect(principal).toMatch(/<select[^>]*name="papel"[^>]*disabled=""/);
    expect(principal).toContain('type="hidden" name="ativo" value="on"');
    expect(principal).toMatch(/<input(?=[^>]*name="ativo")(?=[^>]*disabled="")[^>]*>/);
    expect(principal).not.toContain("Nova senha");
  });
  it.each([PRINCIPAL, null])("capacidade suspensa/configuração inválida falha fechada (principal=%s)", async principalId => {
    f.capacidades.mockResolvedValue(capacidades({ principalId, administradorAtivo: false }));
    const html = await renderUsuarios();
    expect(html).not.toContain("Nova senha"); expect(html).not.toContain("Salvar permissão");
    for (const nome of usuarios.map(x => x.nome)) expect(tr(html, nome)).not.toContain("<form");
    expect(html).not.toContain("Cadastrar pessoa direto");
  });
  it("recusa do guard não lê tabela ou capacidades", async () => {
    f.auth.mockRejectedValue(new Error("sessão recusada"));
    await expect(renderUsuarios()).rejects.toThrow("sessão recusada");
    expect(f.from).not.toHaveBeenCalled(); expect(f.capacidades).not.toHaveBeenCalled();
  });
});

describe("Minha conta: senha atual e exceção compartilhada informada pelo servidor", () => {
  it.each(["admin", "vendedor", "pecas", "recepcao"] as const)("%s mantém formulário da própria senha sem depender de delegação", async papel => {
    f.auth.mockResolvedValue({ ...u, papel });
    const html = await renderConta();
    expect(f.auth).toHaveBeenCalledExactlyOnceWith();
    for (const nome of ["atual", "nova", "confirmar"]) {
      expect(html).toMatch(new RegExp(`<input(?=[^>]*name="${nome}")(?=[^>]*type="password")(?=[^>]*required="")[^>]*>`));
    }
    expect(f.capacidades).not.toHaveBeenCalled();
    expect(html).not.toContain("também valerá neles");
  });
  it("exceção compartilhada mantém senha atual obrigatória e explica efeito nos outros sistemas sem modal", async () => {
    f.auth.mockResolvedValue({ ...u, id: PRINCIPAL }); f.propria.mockResolvedValue({ ok: true, compartilhada: true });
    const html = await renderConta();
    expect(html).toContain("A nova senha também valerá neles");
    expect(html).toMatch(/<input(?=[^>]*name="atual")(?=[^>]*required="")[^>]*>/);
    expect(html).not.toContain("A troca vale só para este sistema");
    expect(html).not.toContain("<dialog"); expect(html).not.toContain('role="dialog"');
  });
  it("conta externa ou falha de leitura conserva recusa sem formulário", async () => {
    f.propria.mockResolvedValue({ ok: false, motivo: "Login compartilhado indisponível para esta operação." });
    const html = await renderConta();
    expect(html).not.toContain("<form"); expect(html).toContain("Login compartilhado indisponível");
  });
});
