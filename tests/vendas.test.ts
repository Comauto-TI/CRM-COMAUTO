import { describe, it, expect } from "vitest";
import {
  veTodasOportunidades, podeMexer, podeAssumir, diasNaEtapa, semaforoEtapa, faixaFunil, taxaConversao, posicaoEntre, ehChave, PAGAMENTOS,
} from "@/modulos/vendas/regras";

const vendedor = { id: "v1", papel: "vendedor" as const };
const outro = { id: "v2", papel: "vendedor" as const };
const gerente = { id: "g1", papel: "gerente" as const };

describe("vendas — quem vê e quem mexe", () => {
  it("gerente e admin veem tudo; vendedor não", () => {
    expect(veTodasOportunidades(gerente)).toBe(true);
    expect(veTodasOportunidades({ id: "a", papel: "admin" })).toBe(true);
    expect(veTodasOportunidades(vendedor)).toBe(false);
  });
  it("vendedor só mexe no próprio cartão; gerente em qualquer um", () => {
    expect(podeMexer(vendedor, { vendedor_id: "v1" })).toBe(true);
    expect(podeMexer(outro, { vendedor_id: "v1" })).toBe(false);
    expect(podeMexer(gerente, { vendedor_id: "v1" })).toBe(true);
    expect(podeMexer(vendedor, { vendedor_id: null })).toBe(false); // precisa assumir antes
  });
  it("lead sem dono pode ser assumido por vendedor; com dono, não", () => {
    expect(podeAssumir(vendedor, { vendedor_id: null })).toBe(true);
    expect(podeAssumir(vendedor, { vendedor_id: "v2" })).toBe(false);
    expect(podeAssumir({ id: "r", papel: "recepcao" }, { vendedor_id: null })).toBe(false);
  });
});

describe("vendas — tempo na etapa e semáforo", () => {
  const agora = new Date("2026-11-10T12:00:00Z");
  it("conta dias inteiros e nunca negativo", () => {
    expect(diasNaEtapa("2026-11-07T12:00:00Z", agora)).toBe(3);
    expect(diasNaEtapa("2026-11-12T12:00:00Z", agora)).toBe(0);
    expect(diasNaEtapa("lixo", agora)).toBe(0);
  });
  it("verde, âmbar a 70% do prazo, vermelho estourado", () => {
    expect(semaforoEtapa(1, 7)).toBe("ok");
    expect(semaforoEtapa(5, 7)).toBe("aviso");
    expect(semaforoEtapa(8, 7)).toBe("critico");
    expect(semaforoEtapa(30, null)).toBe("neutro");
  });
});

describe("vendas — funil e conversão", () => {
  const etapas = [
    { etapa_id: "1", nome: "Novo", ordem: 1, tipo: "aberta" as const, abertas: 5, alcancaram: 40 },
    { etapa_id: "2", nome: "Qualificado", ordem: 3, tipo: "aberta" as const, abertas: 3, alcancaram: 20 },
    { etapa_id: "6", nome: "Ganho", ordem: 6, tipo: "ganho" as const, abertas: 0, alcancaram: 4 },
    { etapa_id: "7", nome: "Perdido", ordem: 7, tipo: "perdido" as const, abertas: 0, alcancaram: 10 },
  ];
  it("faixa em % da entrada, sem a etapa Perdido", () => {
    expect(faixaFunil(etapas).map((e) => e.pct)).toEqual([100, 50, 10]);
    expect(faixaFunil(etapas).some((e) => e.nome === "Perdido")).toBe(false);
  });
  it("funil vazio não divide por zero", () => {
    expect(faixaFunil([]).length).toBe(0);
    expect(faixaFunil(etapas.map((e) => ({ ...e, alcancaram: 0 })))[0].pct).toBe(0);
  });
  it("conversão = ganhos / fechados; sem fechados → null", () => {
    expect(taxaConversao(4, 6)).toBe(40);
    expect(taxaConversao(0, 0)).toBeNull();
  });
});

describe("vendas — utilitários", () => {
  it("posição fracionária entre vizinhos", () => {
    expect(posicaoEntre(null, null)).toBe(1000);
    expect(posicaoEntre(1000, 2000)).toBe(1500);
    expect(posicaoEntre(null, 1000)).toBe(0);
    expect(posicaoEntre(3000, null)).toBe(4000);
  });
  it("valida chave de domínio (não aceita protótipo)", () => {
    expect(ehChave(PAGAMENTOS, "financiamento")).toBe(true);
    expect(ehChave(PAGAMENTOS, "toString")).toBe(false);
    expect(ehChave(PAGAMENTOS, 1)).toBe(false);
  });
});
