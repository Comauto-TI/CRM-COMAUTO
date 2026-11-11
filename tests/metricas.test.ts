import { describe, it, expect } from "vitest";
import {
  conversaoPorGrupo, motivosDePerda, tempoPorEtapa, chancePorEtapa, previsaoDoMes, confiancaPelaBase, funilEvento, type OpMetrica,
} from "@/modulos/metricas/calculos";

const op = (o: Partial<OpMetrica>): OpMetrica => ({
  id: Math.random().toString(36).slice(2), vendedor_id: "v1", origem: "whatsapp", desfecho: "aberta", valor: null,
  criado_em: "2026-11-01T00:00:00Z", fechado_em: null, motivo_perda: null, maior_ordem: 1, ...o,
});

describe("F8 — conversão, perdas e tempo", () => {
  it("conversão por grupo usa só as fechadas no denominador", () => {
    const ops = [op({ desfecho: "ganho" }), op({ desfecho: "perdido" }), op({ desfecho: "aberta" }), op({ vendedor_id: "v2", desfecho: "aberta" })];
    const r = conversaoPorGrupo(ops, (o) => o.vendedor_id ?? "sem");
    expect(r[0]).toEqual({ grupo: "v1", total: 3, ganhos: 1, perdidos: 1, abertas: 1, taxa: 50 });
    expect(r[1].taxa).toBeNull(); // v2 sem fechadas → não inventa taxa
  });
  it("motivos de perda ordenados com %", () => {
    const ops = [op({ desfecho: "perdido", motivo_perda: "Preço" }), op({ desfecho: "perdido", motivo_perda: "Preço" }), op({ desfecho: "perdido", motivo_perda: null })];
    expect(motivosDePerda(ops)).toEqual([{ motivo: "Preço", quantidade: 2, pct: 67 }, { motivo: "Sem motivo", quantidade: 1, pct: 33 }]);
  });
  it("tempo médio por etapa com a base", () => {
    const r = tempoPorEtapa([{ etapa_id: "a", dias: 2 }, { etapa_id: "a", dias: 4 }], [{ id: "b", nome: "B", ordem: 2 }, { id: "a", nome: "A", ordem: 1 }]);
    expect(r).toEqual([{ etapa: "A", ordem: 1, media: 3, base: 2 }, { etapa: "B", ordem: 2, media: null, base: 0 }]);
  });
});

describe("F8 — previsão", () => {
  it("chance por etapa: das fechadas que chegaram até a etapa, quantas ganharam", () => {
    const ops = [op({ desfecho: "ganho", maior_ordem: 6 }), op({ desfecho: "perdido", maior_ordem: 3 }), op({ desfecho: "perdido", maior_ordem: 1 }), op({ desfecho: "aberta", maior_ordem: 5 })];
    const c = chancePorEtapa(ops, [1, 3, 5]);
    expect(c.get(1)).toEqual({ chance: 1 / 3, base: 3 });
    expect(c.get(3)).toEqual({ chance: 1 / 2, base: 2 });
    expect(c.get(5)).toEqual({ chance: 1, base: 1 });
  });
  it("previsão: ritmo do mês e funil ponderado, com confiança pela base", () => {
    const chances = new Map([[1, { chance: 0.2, base: 5 }], [5, { chance: 0.5, base: 5 }]]);
    const p = previsaoDoMes({ ganhosNoMes: 3, diaDoMes: 10, diasNoMes: 30, abertas: [{ ordem: 1 }, { ordem: 1 }, { ordem: 5 }], chances, baseFechadas: 5 });
    expect(p).toEqual({ ritmo: 9, funil: 4, esperadoAbertas: 0.9, confianca: "baixa" });
  });
  it("confiança pela quantidade de fechadas", () => {
    expect([0, 3, 15, 80].map(confiancaPelaBase)).toEqual(["sem_dados", "baixa", "media", "boa"]);
  });
});

describe("F8 — funil de eventos", () => {
  it("passagem no mesmo grupo e % sobre os chamados", () => {
    const s = (...x: string[]) => new Set(x);
    const f = funilEvento({ chamados: s("a", "b", "c", "d"), confirmados: s("a", "b", "z"), presentes: s("a", "c"), vendidos: s("a", "b") });
    expect(f.map((e) => [e.nome, e.quantidade, e.pct])).toEqual([["Chamados", 4, 100], ["Confirmados", 2, 50], ["Presentes", 2, 50], ["Vendidos", 1, 25]]);
  });
  it("sem chamados não divide por zero", () => {
    expect(funilEvento({ chamados: new Set(), confirmados: new Set(), presentes: new Set(), vendidos: new Set() }).every((e) => e.pct === 0)).toBe(true);
  });
});

import { resumoDaCoorte } from "@/modulos/metricas/calculos";
describe("resumoDaCoorte (métricas por pessoa)", () => {
  const etapas = [
    { id: "e1", nome: "Novo", ordem: 1, tipo: "aberta" as const },
    { id: "e2", nome: "Negociação", ordem: 2, tipo: "aberta" as const },
    { id: "g", nome: "Ganho", ordem: 3, tipo: "ganho" as const },
    { id: "p", nome: "Perdido", ordem: 4, tipo: "perdido" as const },
  ];
  const op = (id: string, desfecho: "aberta" | "ganho" | "perdido", maior_ordem: number) =>
    ({ id, vendedor_id: "v", origem: "whatsapp", desfecho, valor: null, criado_em: "2026-11-01", fechado_em: null, motivo_perda: null, maior_ordem });
  it("etapa aberta conta quem alcançou; ganho/perdido contam o desfecho", () => {
    const r = resumoDaCoorte([op("a", "aberta", 1), op("b", "aberta", 2), op("c", "ganho", 3), op("d", "perdido", 1)], etapas);
    expect(r.map((x) => x.alcancaram)).toEqual([4, 2, 1, 1]);
  });
  it("sem oportunidades = zeros", () => {
    expect(resumoDaCoorte([], etapas).every((x) => x.alcancaram === 0)).toBe(true);
  });
});
