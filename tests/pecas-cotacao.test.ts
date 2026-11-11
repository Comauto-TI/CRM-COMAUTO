import { describe, expect, it } from "vitest";
import { lerDadosCotacao, lerDadosItem } from "@/modulos/pecas/dados-cotacao";

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

function item() {
  const form = new FormData();
  form.set("item", "00000000-0000-4000-8000-000000000002");
  form.set("descricao", "  Filtro de óleo  ");
  form.set("quantidade", "3");
  form.set("preco", "19,07");
  return form;
}

describe("entrada de itens da cotação", () => {
  it("converte preços decimais em centavos e preserva custo ausente", () => {
    expect(lerDadosItem(item())).toEqual({
      id: "00000000-0000-4000-8000-000000000002",
      descricao: "Filtro de óleo",
      quantidade: 3,
      precoUnitarioCentavos: 1907,
      custoUnitarioCentavos: null,
    });
  });

  it("aceita ponto decimal, custo zero e o limite de preço", () => {
    const form = item();
    form.set("preco", "999999.99");
    form.set("custo", "0");
    expect(lerDadosItem(form)).toMatchObject({ precoUnitarioCentavos: 99999999, custoUnitarioCentavos: 0 });
  });

  it.each([
    ["item", "sem-id"],
    ["descricao", " "],
    ["quantidade", "0"],
    ["quantidade", "1.5"],
    ["quantidade", "10000"],
    ["preco", "1,999"],
    ["preco", "1000000"],
    ["preco", "-1"],
    ["custo", "1e3"],
  ])("rejeita %s com valor %s", (campo, valor) => {
    const form = item();
    form.set(campo, valor);
    expect(lerDadosItem(form)).toBeNull();
  });
});
