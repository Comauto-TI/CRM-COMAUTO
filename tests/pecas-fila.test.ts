import { beforeEach, describe, expect, it, vi } from "vitest";
import { listarCotacoes } from "@/modulos/pecas/cotacoes";
import { lerFiltrosFila } from "@/modulos/pecas/dados-cotacao";
import type { Usuario } from "@/lib/auth";

type Linha = { id: string; unidade: string; status: string; criado_em: string };
const fixture = vi.hoisted(() => ({ linhas: [] as Linha[] }));
const usuario: Usuario = { id: "10000000-0000-4000-8000-000000000001", email: "pecas@exemplo.invalid", nome: "Peças", papel: "pecas", setor: "pecas", unidade: "comauto", unidades: ["comauto"] };

vi.mock("@/lib/supabase/admin", () => ({
  db: () => ({
    rpc(funcao: string, parametros: { p_ator: string }) {
      expect(funcao).toBe("pecas_cotacoes_visiveis");
      expect(parametros).toEqual({ p_ator: usuario.id });
      // A política real de carteira/unidade é coberta no contrato SQL; aqui só a paginação do conjunto autorizado.
      const filtros: ((linha: Linha) => boolean)[] = [(linha) => linha.unidade === "comauto"];
      const ordens: { campo: keyof Linha; crescente: boolean }[] = [];
      return {
        select() { return this; },
        in(campo: keyof Linha, valores: string[]) {
          filtros.push((linha) => valores.includes(linha[campo]));
          return this;
        },
        order(campo: keyof Linha, opcoes?: { ascending?: boolean }) {
          ordens.push({ campo, crescente: opcoes?.ascending !== false });
          return this;
        },
        async range(inicio: number, fim: number) {
          const data = fixture.linhas.filter((linha) => filtros.every((filtro) => filtro(linha)));
          data.sort((a, b) => {
            for (const ordem of ordens) {
              const resultado = a[ordem.campo].localeCompare(b[ordem.campo]);
              if (resultado) return ordem.crescente ? resultado : -resultado;
            }
            return 0;
          });
          return { data: data.slice(inicio, fim + 1), error: null };
        },
      };
    },
  }),
}));

describe("fila paginada de Peças", () => {
  beforeEach(() => {
    fixture.linhas = Array.from({ length: 121 }, (_, i) => ({
      id: String(i + 1).padStart(5, "0"), unidade: "comauto", status: "novo", criado_em: "2026-01-01",
    }));
    fixture.linhas.push(...Array.from({ length: 120 }, (_, i) => ({
      id: "encerrada-" + i, unidade: "comauto", status: "cancelado", criado_em: "2026-02-01",
    })));
    fixture.linhas.push({ id: "outra-unidade", unidade: "santaluzia", status: "novo", criado_em: "2026-03-01" });
  });

  it("mantém todas as 121 cotações abertas acessíveis apesar de encerradas mais recentes", async () => {
    const ids: string[] = [];
    for (const pagina of [1, 2, 3]) {
      const fila = await listarCotacoes(usuario, { pagina, fila: "abertas" });
      expect(fila.ok).toBe(true);
      if (!fila.ok) throw new Error("Falha na fixture");
      expect(fila.cotacoes).toHaveLength(pagina < 3 ? 50 : 21);
      expect(fila.temMais).toBe(pagina < 3);
      ids.push(...fila.cotacoes.map((cotacao) => cotacao.id));
    }
    expect(ids).toHaveLength(121);
    expect(new Set(ids).size).toBe(121);
    expect(ids[120]).toBe("00121");
    expect(ids).not.toContain("outra-unidade");
  });

  it("permite consultar as encerradas separadamente", async () => {
    const fila = await listarCotacoes(usuario, { pagina: 1, fila: "encerradas" });
    expect(fila.ok).toBe(true);
    if (!fila.ok) throw new Error("Falha na fixture");
    expect(fila.cotacoes).toHaveLength(50);
    expect(fila.cotacoes.every((cotacao) => cotacao.status === "cancelado")).toBe(true);
    expect(fila.temMais).toBe(true);
  });

  it("normaliza os filtros recebidos na URL", () => {
    expect(lerFiltrosFila({ pagina: "3", fila: "encerradas" })).toEqual({ pagina: 3, fila: "encerradas" });
    expect(lerFiltrosFila({ pagina: ["2"], fila: ["encerradas"] })).toEqual({ pagina: 1, fila: "abertas" });
    expect(lerFiltrosFila({ pagina: "9007199254740991", fila: "qualquer" })).toEqual({ pagina: 1, fila: "abertas" });
  });
});
