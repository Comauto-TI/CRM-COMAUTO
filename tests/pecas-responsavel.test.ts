import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Usuario } from "@/lib/auth";
import { listarResponsaveis, reatribuirCotacao } from "@/modulos/pecas/cotacoes";

const fixture = vi.hoisted(() => ({
  rpc: vi.fn(),
  equipe: vi.fn(),
}));

vi.mock("@/lib/supabase/admin", () => ({
  db: () => ({
    rpc: fixture.rpc,
    from() {
      return {
        select() { return this; },
        eq() { return this; },
        order: fixture.equipe,
      };
    },
  }),
}));

const gestor: Usuario = {
  id: "00000000-0000-4000-8000-000000000061",
  email: "gestor@example.invalid", nome: "Gestor fictício",
  papel: "gerente", setor: "pecas", unidade: "comauto", unidades: ["comauto"],
};

describe("gestão do responsável de Peças", () => {
  beforeEach(() => {
    fixture.rpc.mockReset().mockResolvedValue({ data: true, error: null });
    fixture.equipe.mockReset().mockResolvedValue({ data: [], error: null });
  });

  it("recusa transferência por operador ou gerente de outro setor", async () => {
    expect(await reatribuirCotacao({ ...gestor, papel: "pecas" }, "cotacao", "destino")).toBe("indisponivel");
    expect(await reatribuirCotacao({ ...gestor, setor: "vendas" }, "cotacao", "destino")).toBe("indisponivel");
    expect(fixture.rpc).not.toHaveBeenCalled();
  });

  it("usa identidade e unidades da sessão e respeita a recusa do banco", async () => {
    fixture.rpc.mockResolvedValue({ data: false, error: null });
    expect(await reatribuirCotacao(gestor, "cotacao", "destino")).toBe("indisponivel");
    expect(fixture.rpc).toHaveBeenCalledWith("pecas_reatribuir_cotacao", {
      p_id: "cotacao", p_unidades: ["comauto"], p_ator: gestor.id, p_responsavel: "destino",
    });
  });

  it("não informa sucesso quando a migration ainda não está disponível", async () => {
    fixture.rpc.mockResolvedValue({ data: null, error: { code: "PGRST202" } });
    expect(await reatribuirCotacao(gestor, "cotacao", "destino")).toBe("pendente");
  });

  it("lista apenas responsáveis com acesso ao setor e à unidade, incluindo unidade extra", async () => {
    fixture.equipe.mockResolvedValue({ error: null, data: [
      { user_id: "local", nome: "Local", papel: "pecas", setor: "pecas", unidade: "comauto", usuario_unidades: [] },
      { user_id: "extra", nome: "Extra", papel: "gerente", setor: "administracao", unidade: "motomecanica", usuario_unidades: [{ unidade: "comauto" }] },
      { user_id: "fora", nome: "Fora", papel: "pecas", setor: "pecas", unidade: "motomecanica", usuario_unidades: [] },
      { user_id: "vendas", nome: "Vendas", papel: "gerente", setor: "vendas", unidade: "comauto", usuario_unidades: [] },
    ] });
    expect(await listarResponsaveis(gestor, "comauto")).toEqual({ ok: true, usuarios: [
      { id: "local", nome: "Local" }, { id: "extra", nome: "Extra" },
    ] });
    expect(await listarResponsaveis(gestor, "santaluzia")).toEqual({ ok: false });
    expect(fixture.equipe).toHaveBeenCalledTimes(1);
  });
});
