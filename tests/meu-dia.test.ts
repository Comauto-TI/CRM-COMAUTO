import { describe, it, expect } from "vitest";
import { classificarMeuDia, type CartaoDia, type TarefaDia } from "@/modulos/vendas/meu-dia-regras";

const agora = new Date("2026-11-11T14:00:00Z");
const fim = new Date("2026-11-12T03:00:00Z");
const t = (id: string, prazo: string): TarefaDia => ({ id, titulo: id, prazo, oportunidadeId: "o", cliente: "c", funil: "novos" });
const c = (id: string, o: Partial<CartaoDia>): CartaoDia => ({
  id, cliente: id, funil: "novos", etapa: "Novo", ordemEtapa: 1, primeiraOrdem: 1, slaDias: 3,
  entrouEm: "2026-11-11T10:00:00Z", criadoEm: "2026-11-11T10:00:00Z", teveContatoHumano: true, ...o,
});

describe("meu dia do vendedor", () => {
  it("separa tarefas atrasadas e de hoje (amanhã fica de fora)", () => {
    const r = classificarMeuDia([t("ontem", "2026-11-10T12:00:00Z"), t("tarde", "2026-11-11T18:00:00Z"), t("amanha", "2026-11-12T12:00:00Z")], [], agora, fim);
    expect(r.atrasadas.map((x) => x.id)).toEqual(["ontem"]);
    expect(r.hoje.map((x) => x.id)).toEqual(["tarde"]);
  });
  it("lead novo sem contato humano há mais de 2h; recém-chegado ainda não", () => {
    const r = classificarMeuDia([], [
      c("velho", { teveContatoHumano: false, criadoEm: "2026-11-11T09:00:00Z" }),
      c("recente", { teveContatoHumano: false, criadoEm: "2026-11-11T13:30:00Z" }),
      c("contatado", { teveContatoHumano: true, criadoEm: "2026-11-11T09:00:00Z" }),
      c("outra-etapa", { teveContatoHumano: false, ordemEtapa: 2, criadoEm: "2026-11-11T09:00:00Z" }),
    ], agora, fim);
    expect(r.semContato.map((x) => x.id)).toEqual(["velho"]);
  });
  it("parado = estourou o prazo da etapa; mais estourado primeiro; sem prazo não conta", () => {
    const r = classificarMeuDia([], [
      c("4d", { entrouEm: "2026-11-07T10:00:00Z", ordemEtapa: 2 }),
      c("10d", { entrouEm: "2026-11-01T10:00:00Z", ordemEtapa: 2 }),
      c("2d", { entrouEm: "2026-11-09T10:00:00Z", ordemEtapa: 2 }),
      c("sem-sla", { entrouEm: "2026-10-01T10:00:00Z", ordemEtapa: 2, slaDias: null }),
    ], agora, fim);
    expect(r.parados.map((x) => x.id)).toEqual(["10d", "4d"]);
  });
  it("lead sem contato não aparece duplicado como parado", () => {
    const r = classificarMeuDia([], [c("x", { teveContatoHumano: false, criadoEm: "2026-11-01T10:00:00Z", entrouEm: "2026-11-01T10:00:00Z" })], agora, fim);
    expect(r.semContato).toHaveLength(1);
    expect(r.parados).toHaveLength(0);
    expect(r.total).toBe(1);
  });
});
