import { describe, expect, it } from "vitest";
import { grupoDoAgendamento, resumoDoDia, textoAtraso, minutosDeAtraso } from "@/lib/scheduling/acompanhamento";

const agora = new Date("2026-11-12T13:00:00Z");
const ha = (min: number) => new Date(agora.getTime() - min * 60_000).toISOString();

describe("acompanhamento do dia", () => {
  it("atrasado só depois da tolerância e só para pendente/confirmado", () => {
    expect(grupoDoAgendamento({ status: "confirmado", inicio: ha(15) }, agora)).toBe("aguardando");
    expect(grupoDoAgendamento({ status: "confirmado", inicio: ha(16) }, agora)).toBe("atrasado");
    expect(grupoDoAgendamento({ status: "pendente", inicio: ha(40) }, agora)).toBe("atrasado");
    expect(grupoDoAgendamento({ status: "pendente", inicio: ha(-30) }, agora)).toBe("aguardando");
    expect(grupoDoAgendamento({ status: "pendente", inicio: ha(10) }, agora, 5)).toBe("atrasado");
  });
  it("status marcados não viram atrasado", () => {
    expect(grupoDoAgendamento({ status: "compareceu", inicio: ha(90) }, agora)).toBe("veio");
    expect(grupoDoAgendamento({ status: "nao_compareceu", inicio: ha(90) }, agora)).toBe("nao_veio");
    expect(grupoDoAgendamento({ status: "cancelado", inicio: ha(90) }, agora)).toBe("cancelado");
  });
  it("resumo: total sem cancelados e taxa entre os decididos", () => {
    const r = resumoDoDia(["veio", "veio", "veio", "nao_veio", "atrasado", "aguardando", "cancelado"]);
    expect(r.total).toBe(6);
    expect(r.taxaComparecimento).toBe(75);
    expect(resumoDoDia(["aguardando"]).taxaComparecimento).toBeNull();
  });
  it("texto do atraso", () => {
    expect(textoAtraso(7)).toBe("há 7 min");
    expect(textoAtraso(60)).toBe("há 1h");
    expect(textoAtraso(85)).toBe("há 1h25");
    expect(minutosDeAtraso(ha(30), agora)).toBe(30);
  });
});
