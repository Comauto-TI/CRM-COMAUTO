import { describe, it, expect } from "vitest";
import { ordenarQuadro, iniciais, posicaoEntre, semaforoEtapa, diasNaEtapa } from "@/lib/quadro";
import { ordenarCartoes } from "@/modulos/vendas/regras";

const c = (id: string, posicao: number, criadoEm: string, valor: number | null, entrouEm: string, ultimoContatoEm: string | null) =>
  ({ id, posicao, criadoEm, valor, entrouEm, ultimoContatoEm });

describe("quadro comum", () => {
  const lista = [
    c("a", 3000, "2026-11-01", 50, "2026-11-05", "2026-11-10"),
    c("b", 1000, "2026-11-03", 900, "2026-11-02", null),
    c("c", 2000, "2026-11-02", null, "2026-11-08", "2026-11-09"),
  ];
  const ids = (l: { id: string }[]) => l.map((x) => x.id).join("");
  it("ordena por posição, recentes, valor, parado e contato", () => {
    expect(ids(ordenarQuadro(lista, "posicao", (x) => x))).toBe("bca");
    expect(ids(ordenarQuadro(lista, "recentes", (x) => x))).toBe("bca");
    expect(ids(ordenarQuadro(lista, "valor", (x) => x))).toBe("bac");
    expect(ids(ordenarQuadro(lista, "parado", (x) => x))).toBe("bac");
    expect(ids(ordenarQuadro(lista, "contato", (x) => x))).toBe("bca");
  });
  it("não altera a lista original", () => {
    ordenarQuadro(lista, "valor", (x) => x);
    expect(ids(lista)).toBe("abc");
  });
  it("Vendas ordena igual ao quadro comum", () => {
    const v = lista.map((x) => ({ id: x.id, posicao: x.posicao, criado_em: x.criadoEm, valor_estimado: x.valor, entrou_na_etapa_em: x.entrouEm, ultimo_contato_em: x.ultimoContatoEm }));
    for (const o of ["posicao", "recentes", "valor", "parado", "contato"] as const) {
      expect(ids(ordenarCartoes(v, o))).toBe(ids(ordenarQuadro(lista, o, (x) => x)));
    }
  });
  it("iniciais, posição e semáforo", () => {
    expect(iniciais("maria da silva")).toBe("MD");
    expect(iniciais(null)).toBe("?");
    expect(posicaoEntre(1000, null)).toBe(2000);
    expect(semaforoEtapa(8, 10)).toBe("aviso");
    expect(diasNaEtapa("2026-11-01T00:00:00Z", new Date("2026-11-03T12:00:00Z"))).toBe(2);
  });
});
