import { describe, expect, it } from "vitest";
import { centavosParaCampo, lerDadosCotacao, lerDadosEdicaoItem, lerDadosEncerramento, lerDadosItem, totalizarCotacao } from "@/modulos/pecas/dados-cotacao";

function pedido() {
  const form = new FormData();
  form.set("solicitacao", "00000000-0000-4000-8000-000000000001");
  form.set("telefone", "(51) 99999-0000");
  form.set("descricao", "  Filtro de óleo  ");
  return form;
}

describe("total e margem da venda", () => {
  const itens = [
    { quantidade: 3, preco_unitario_centavos: 1907, custo_unitario_centavos: 1000 },
    { quantidade: 2, preco_unitario_centavos: 250, custo_unitario_centavos: 0 },
  ];

  it("calcula a margem em centavos quando a venda está confirmada e o custo está completo", () => {
    expect(totalizarCotacao(itens, true)).toEqual({ totalCentavos: 6221, margemCentavos: 3221 });
  });

  it("omite a margem antes de confirmar a venda", () => {
    expect(totalizarCotacao(itens, false)).toEqual({ totalCentavos: 6221, margemCentavos: null });
  });

  it("mantém o total e omite a margem quando falta o custo de um item", () => {
    const itensComCustoParcial = [itens[0], { ...itens[1], custo_unitario_centavos: null }];
    expect(totalizarCotacao(itensComCustoParcial, true)).toEqual({ totalCentavos: 6221, margemCentavos: null });
  });
});

describe("encerramento da cotação", () => {
  it.each(["perdido", "cancelado"])("aceita %s com motivo aparado", (destino) => {
    const form = new FormData();
    form.set("destino", destino);
    form.set("motivo", "  Cliente desistiu  ");
    expect(lerDadosEncerramento(form)).toEqual({ destino, motivo: "Cliente desistiu" });
  });

  it.each([
    ["perdido", " \n "],
    ["cancelado", "x".repeat(501)],
    ["entregue", "Pedido entregue"],
  ])("rejeita destino ou motivo inválido para %s", (destino, motivo) => {
    const form = new FormData();
    form.set("destino", destino);
    form.set("motivo", motivo);
    expect(lerDadosEncerramento(form)).toBeNull();
  });
});

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

describe("edição de itens da cotação", () => {
  it("reabre o preço com centavos sem alterar o valor ao salvar outro campo", () => {
    const form = item();
    form.set("preco", centavosParaCampo(1250050));
    form.set("custo", centavosParaCampo(0));
    form.set("versao", "3");
    expect(lerDadosEdicaoItem(form)).toMatchObject({
      precoUnitarioCentavos: 1250050,
      custoUnitarioCentavos: 0,
      versao: 3,
    });

    form.set("custo", centavosParaCampo(null));
    expect(lerDadosEdicaoItem(form)?.custoUnitarioCentavos).toBeNull();
  });

  it.each(["", "0", "1.5", "2147483648"])("rejeita versão inválida %s", (versao) => {
    const form = item();
    form.set("versao", versao);
    expect(lerDadosEdicaoItem(form)).toBeNull();
  });
});
