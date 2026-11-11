import { describe, expect, it } from "vitest";
import { lerDadosCotacao } from "@/modulos/pecas/dados-cotacao";

function pedido() {
  const form = new FormData();
  form.set("solicitacao", "00000000-0000-4000-8000-000000000001");
  form.set("telefone", "(51) 99999-0000");
  form.set("descricao", "  Filtro de óleo  ");
  return form;
}

describe("entrada da cotação de balcão", () => {
  it("mantém o identificador de repetição e aceita cotação sem placa", () => {
    expect(lerDadosCotacao(pedido())).toEqual({
      id: "00000000-0000-4000-8000-000000000001",
      telefone: "5551999990000",
      descricao: "Filtro de óleo",
      placa: null,
    });
  });

  it("normaliza placa e rejeita texto livre nesse campo", () => {
    const form = pedido();
    form.set("placa", "abc-1d23");
    expect(lerDadosCotacao(form)?.placa).toBe("ABC1D23");
    form.set("placa", "veículo desconhecido");
    expect(lerDadosCotacao(form)).toBeNull();
  });

  it("rejeita pedido sem identificador válido ou sem descrição útil", () => {
    const form = pedido();
    form.set("descricao", " ");
    expect(lerDadosCotacao(form)).toBeNull();
    form.set("descricao", "Filtro");
    form.set("solicitacao", "repetir");
    expect(lerDadosCotacao(form)).toBeNull();
  });
});
