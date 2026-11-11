import { describe, expect, it } from "vitest";
import { lerDadosAtendimento } from "@/modulos/oficina/dados-atendimento";

function solicitacao() {
  const form = new FormData();
  form.set("solicitacao", "00000000-0000-4000-8000-000000000071");
  form.set("telefone", "(51) 99999-0000");
  form.set("descricao", "  Ruído na suspensão  ");
  return form;
}

describe("entrada da fila de Oficina", () => {
  it("normaliza telefone e descrição e aceita veículo opcional", () => {
    expect(lerDadosAtendimento(solicitacao())).toEqual({
      id: "00000000-0000-4000-8000-000000000071",
      telefone: "5551999990000",
      descricao: "Ruído na suspensão",
      placa: null,
    });
  });

  it("normaliza placa Mercosul", () => {
    const form = solicitacao();
    form.set("placa", "abc-1d23");
    expect(lerDadosAtendimento(form)?.placa).toBe("ABC1D23");
  });

  it.each([
    ["solicitacao", "sem-id"],
    ["telefone", "123"],
    ["placa", "veículo desconhecido"],
    ["descricao", " "],
    ["descricao", "x".repeat(1001)],
  ])("rejeita %s inválido", (campo, valor) => {
    const form = solicitacao();
    form.set(campo, valor);
    expect(lerDadosAtendimento(form)).toBeNull();
  });
});
