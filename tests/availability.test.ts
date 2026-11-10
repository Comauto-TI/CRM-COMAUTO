import { describe, it, expect } from "vitest";
import { calcularSlots, type ParamsSlots } from "@/lib/scheduling/availability";
import { horaLocal, dataLocalISO } from "@/lib/time";

const OFF = "-03:00";
const base = (over: Partial<ParamsSlots> = {}): ParamsSlots => ({
  // terça-feira 10/11/2026 07:00 local (dia_semana 2)
  agora: new Date("2026-11-10T07:00:00-03:00"),
  offset: OFF,
  agenda: { antecedencia_min_horas: 2, janela_dias: 30, passo_min: 30, intervalo_min: 0 },
  horarios: [
    { dia_semana: 2, abre: "08:00", fecha: "12:00" },
    { dia_semana: 2, abre: "13:00", fecha: "18:00" },
    { dia_semana: 3, abre: "08:00", fecha: "12:00" },
  ],
  recursos: [{ id: "box1", nome: "Box 1" }],
  ocupados: [],
  bloqueios: [],
  duracaoMin: 60,
  limite: 50,
  ...over,
});

describe("calcularSlots", () => {
  it("respeita antecedência mínima (agora 07:00 + 2h => primeiro 09:00)", () => {
    const s = calcularSlots(base({ dataPreferida: "2026-11-10" }));
    expect(horaLocal(s[0].inicio, OFF)).toBe("09:00");
  });

  it("não atravessa o almoço (serviço de 60 min: último da manhã 11:00, tarde começa 13:00)", () => {
    const horas = calcularSlots(base({ dataPreferida: "2026-11-10" })).map((x) => horaLocal(x.inicio, OFF));
    expect(horas).toContain("11:00");
    expect(horas).not.toContain("11:30");
    expect(horas).not.toContain("12:00");
    expect(horas).toContain("13:00");
    expect(horas.at(-1)).toBe("17:00");
  });

  it("pula horário ocupado no mesmo recurso", () => {
    const s = calcularSlots(
      base({
        dataPreferida: "2026-11-10",
        ocupados: [{ recurso_id: "box1", inicio: "2026-11-10T09:00:00-03:00", fim: "2026-11-10T10:00:00-03:00" }],
      }),
    ).map((x) => horaLocal(x.inicio, OFF));
    expect(s).not.toContain("09:00");
    expect(s).not.toContain("09:30"); // 09:30-10:30 sobrepõe 09:00-10:00
    expect(s).toContain("10:00");
  });

  it("usa outro recurso quando o primeiro está ocupado", () => {
    const s = calcularSlots(
      base({
        dataPreferida: "2026-11-10",
        recursos: [{ id: "box1", nome: "Box 1" }, { id: "box2", nome: "Box 2" }],
        ocupados: [{ recurso_id: "box1", inicio: "2026-11-10T09:00:00-03:00", fim: "2026-11-10T10:00:00-03:00" }],
      }),
    );
    const nove = s.find((x) => horaLocal(x.inicio, OFF) === "09:00");
    expect(nove?.recursoId).toBe("box2");
  });

  it("feriado (bloqueio geral) zera o dia", () => {
    const s = calcularSlots(
      base({
        dataPreferida: "2026-11-10",
        bloqueios: [{ recurso_id: null, inicio: "2026-11-10T00:00:00-03:00", fim: "2026-11-11T00:00:00-03:00" }],
      }),
    );
    expect(s).toHaveLength(0);
  });

  it("filtra período da tarde", () => {
    const s = calcularSlots(base({ dataPreferida: "2026-11-10", periodo: "tarde" }));
    expect(s.every((x) => horaLocal(x.inicio, OFF) >= "12:00")).toBe(true);
  });

  it("sem data preferida, avança para os próximos dias até o limite", () => {
    const s = calcularSlots(base({ limite: 20 }));
    const dias = new Set(s.map((x) => dataLocalISO(x.inicio, OFF)));
    expect(dias.size).toBeGreaterThan(1);
    expect(s).toHaveLength(20);
  });

  it("intervalo entre atendimentos afasta o próximo horário", () => {
    const s = calcularSlots(
      base({
        dataPreferida: "2026-11-10",
        agenda: { antecedencia_min_horas: 0, janela_dias: 30, passo_min: 30, intervalo_min: 30 },
        agora: new Date("2026-11-10T06:00:00-03:00"),
        ocupados: [{ recurso_id: "box1", inicio: "2026-11-10T08:00:00-03:00", fim: "2026-11-10T09:00:00-03:00" }],
      }),
    ).map((x) => horaLocal(x.inicio, OFF));
    expect(s).not.toContain("09:00");
    expect(s).toContain("09:30");
  });
});
