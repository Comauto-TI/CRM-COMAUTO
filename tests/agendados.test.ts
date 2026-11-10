import { describe, it, expect } from "vitest";
import { validarHorario, decidirEnvioAgendado, explicarBloqueio } from "@/lib/agendados-regras";

describe("F2-4 — lembretes e mensagens agendadas", () => {
  const agora = new Date("2026-11-10T12:00:00Z");
  it("horário: futuro, até 180 dias", () => {
    expect(validarHorario(new Date("2026-11-10T15:00:00Z"), agora)).toEqual({ ok: true });
    expect(validarHorario(new Date("2026-11-10T11:00:00Z"), agora).ok).toBe(false);
    expect(validarHorario(new Date("2026-11-10T12:00:30Z"), agora).ok).toBe(false); // menos de 1 min
    expect(validarHorario(new Date("2027-07-10T12:00:00Z"), agora).ok).toBe(false);
    expect(validarHorario(new Date("lixo"), agora).ok).toBe(false);
  });
  it("envio: opt-out nunca; janela aberta = texto do usuário; fechada = só template", () => {
    expect(decidirEnvioAgendado({ optout: true, janelaAberta: true })).toBe("bloquear_optout");
    expect(decidirEnvioAgendado({ optout: false, janelaAberta: true })).toBe("livre");
    expect(decidirEnvioAgendado({ optout: false, janelaAberta: false })).toBe("template");
  });
  it("explica o bloqueio em português para quem agendou", () => {
    expect(explicarBloqueio("optout")).toMatch(/não receber/);
    expect(explicarBloqueio("sem_consentimento_servico")).toMatch(/não autorizou/);
    expect(explicarBloqueio("template_nao_aprovado")).toMatch(/Meta/);
    expect(explicarBloqueio("algo_novo")).toBe("algo novo");
  });
});

describe("F2-4 — erro devolvido pela Meta vira texto amigável", () => {
  it("erro técnico do WhatsApp", () => {
    expect(explicarBloqueio("Invalid OAuth access token - Cannot parse access token")).toMatch(/^o WhatsApp não aceitou o envio/);
  });
});
