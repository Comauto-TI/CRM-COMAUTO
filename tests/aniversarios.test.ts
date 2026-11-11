import { describe, it, expect } from "vitest";
import { aniversarioMaisProximo, classificarAniversario, quandoAniversario, idadeNoAniversario, ordenarAniversarios } from "@/modulos/vendas/aniversarios";

describe("F5 — aniversários", () => {
  it("acha o aniversário mais próximo, inclusive na virada do ano", () => {
    expect(aniversarioMaisProximo("1985-11-14", "2026-11-11")).toEqual({ data: "2026-11-14", dias: 3 });
    expect(aniversarioMaisProximo("1990-01-02", "2026-12-29")).toEqual({ data: "2027-01-02", dias: 4 });
    expect(aniversarioMaisProximo("1990-12-30", "2027-01-03")).toEqual({ data: "2026-12-30", dias: -4 });
  });
  it("29 de fevereiro vira 28 em ano não bissexto", () => {
    expect(aniversarioMaisProximo("2000-02-29", "2027-02-25")).toEqual({ data: "2027-02-28", dias: 3 });
    expect(aniversarioMaisProximo("2000-02-29", "2028-02-25")).toEqual({ data: "2028-02-29", dias: 4 });
  });
  it("semáforo: amarelo antes, verde no dia, vermelho depois sem contato; fora da janela some", () => {
    expect(classificarAniversario("1985-11-14", "2026-11-11", false)?.estado).toBe("proximo");
    expect(classificarAniversario("1985-11-11", "2026-11-11", false)?.estado).toBe("hoje");
    expect(classificarAniversario("1985-11-08", "2026-11-11", false)?.estado).toBe("passou");
    expect(classificarAniversario("1985-11-08", "2026-11-11", true)?.estado).toBe("feito");
    expect(classificarAniversario("1985-12-25", "2026-11-11", false)).toBeNull();
    expect(classificarAniversario(null, "2026-11-11", false)).toBeNull();
    expect(classificarAniversario("1985-11-25", "2026-11-11", false, 15)?.estado).toBe("proximo"); // antecedência configurável
  });
  it("textos e idade", () => {
    expect([0, 1, -1, 5, -3].map(quandoAniversario)).toEqual(["hoje", "amanhã", "ontem", "em 5 dias", "há 3 dias"]);
    expect(idadeNoAniversario("1985-11-14", "2026-11-14")).toBe(41);
  });
  it("ordem: vermelho, hoje, próximos, feitos", () => {
    const l = [{ estado: "proximo" as const, dias: 3 }, { estado: "feito" as const, dias: -1 }, { estado: "passou" as const, dias: -2 }, { estado: "hoje" as const, dias: 0 }, { estado: "proximo" as const, dias: 1 }];
    expect(ordenarAniversarios(l).map((x) => `${x.estado}${x.dias}`)).toEqual(["passou-2", "hoje0", "proximo1", "proximo3", "feito-1"]);
  });
});
